/**
 * Building cover from a loss curve rather than from a budget.
 *
 * `priceCover` answers "I have $300, what does it buy?" — a trading question
 * that happens to be the wrong way round for insurance. Nobody decides how much
 * fire cover to hold by picking a premium first. They start from the building.
 *
 * `solveCover` starts from the loss: given a fitted curve and a live ladder, it
 * sizes each rung to the loss expected on the days that rung pays, prices the
 * result, and replays it over history so the premium arrives attached to
 * evidence of what it would have done.
 */
import { backtest, sizeLegsFromHistory } from "./backtest.js";
import type { BacktestResult, CoverLeg } from "./backtest.js";
import { selectLossRungs } from "./backtest.js";
import { expectedLoss } from "./loss.js";
import type { LossCurve, LossDirection } from "./loss.js";
import { sliceByDate } from "./observations.js";
import type { DailySeries } from "./observations.js";
import type { Ladder, StrikeUnit } from "./types.js";

export interface CoverPlan {
  legs: CoverLeg[];
  /** Premium for one day of cover across every rung. */
  premiumPerDayUsd: number;
  /** Most the structure can pay on a single day. */
  limitUsd: number;
  /** Where cover starts paying — the fitted threshold. */
  attachment: number;
  direction: LossDirection;
  /** Worst daily loss seen in the replay window. */
  worstDayLossUsd: number;
  /** How much of that worst day the structure would have covered, 0–1. */
  worstDayCovered: number;
  /**
   * Expected payout ÷ premium, from the replay. Below 1 the cover has
   * historically cost more than it returned, which is normal for insurance and
   * is the price of transferring the risk.
   */
  expectedLossRatio: number | null;
  replay: BacktestResult;
  /**
   * True when the replay ran on days the sizing never saw. False means history
   * was too short to split, so the result is in-sample and flattering.
   */
  outOfSample: boolean;
  unit: StrikeUnit;
  warnings: string[];
}

/** Below this the fitted curve is too weak to justify buying anything. */
const WEAK_FIT_R_SQUARED = 0.15;

/** Below this share of loss days caught, the station is the wrong proxy. */
const WEAK_TRIGGER_CORRELATION = 0.6;

/**
 * Most a structure can pay on one day.
 *
 * Ladder buckets are disjoint, so a day lands in exactly one and the limit is
 * simply the largest rung. Evaluating the payout at each bucket rather than
 * assuming that keeps the number right if legs ever come from overlapping
 * sources.
 */
function limitOf(legs: CoverLeg[]): number {
  let limit = 0;
  for (const leg of legs) {
    const probe = leg.strike.floor ?? leg.strike.cap;
    if (probe === null) continue;
    let payout = 0;
    for (const other of legs) {
      const withinFloor = other.strike.floor === null || probe >= other.strike.floor;
      const withinCap = other.strike.cap === null || probe <= other.strike.cap;
      if (withinFloor && withinCap) payout += other.contracts;
    }
    limit = Math.max(limit, payout);
  }
  return limit;
}

function planWarnings(args: {
  curve: LossCurve;
  replay: BacktestResult;
  legs: CoverLeg[];
  outOfSample: boolean;
}): string[] {
  const out: string[] = [];
  if (!args.outOfSample) {
    out.push(
      "Not enough history to hold days back, so this structure was scored on the same days it was sized on. Treat the result as optimistic.",
    );
  }
  if (args.curve.rSquared < WEAK_FIT_R_SQUARED) {
    out.push(
      `Weather explains only ${Math.round(args.curve.rSquared * 100)}% of this business's revenue swings — cover may be hedging a risk it doesn't have.`,
    );
  }
  if (args.replay.realizedTriggerCorrelation < WEAK_TRIGGER_CORRELATION) {
    out.push(
      `The station only paid on ${Math.round(args.replay.realizedTriggerCorrelation * 100)}% of the days this business was hurting — consider a closer station or a basket.`,
    );
  }
  if (args.replay.swingReduction <= 0) {
    out.push(
      "This structure would have made the year bumpier, not smoother. Don't buy it as written.",
    );
  }
  if (args.legs.length === 0) {
    out.push("No rung on this ladder sits in the loss region with a live ask.");
  }
  return out;
}

export interface SolveCoverArgs {
  ladder: Ladder;
  curve: LossCurve;
  /** Observations at the station the ladder settles on. */
  station: DailySeries;
  /** Observations at the business's own location. */
  premises: DailySeries;
  /** Calendar months the business is exposed. */
  months?: number[];
  /**
   * Share of history held back for evaluation, 0–1. Sizing uses the earlier
   * portion and the replay uses the later one.
   */
  holdoutFraction?: number;
}

const DEFAULT_HOLDOUT = 0.3;

/** Below this many days on either side, a split leaves neither part usable. */
const MIN_SPLIT_DAYS = 60;

/**
 * Split history chronologically so the structure is judged on days it wasn't
 * sized on.
 *
 * Sizing each rung to its own historical loss and then scoring it against the
 * same days is in-sample evaluation: the structure is fitted to the very
 * outcomes it is then congratulated for covering, and the swing reduction comes
 * out flattering. Holding back the most recent stretch is the cheapest
 * available guard against selling a client a number that won't repeat.
 */
function splitDate(dates: string[], holdout: number): string | null {
  const usable = dates.filter((d) => d !== "").toSorted();
  const cut = Math.floor(usable.length * (1 - holdout));
  if (cut < MIN_SPLIT_DAYS || usable.length - cut < MIN_SPLIT_DAYS) return null;
  return usable[cut] ?? null;
}

/**
 * Solve the structure a loss curve implies, price it, and replay it.
 *
 * Sizing is an output here, not an input. The premium falls out of the loss;
 * asking the client for a budget first is what turns cover back into a bet.
 */
export function solveCover(args: SolveCoverArgs): CoverPlan {
  const months = args.months && args.months.length > 0 ? args.months : undefined;
  const monthArg = months ? { months } : {};
  const rungs = selectLossRungs(args.ladder, args.curve);

  const cut = splitDate(args.station.dates, args.holdoutFraction ?? DEFAULT_HOLDOUT);
  const sizingWindow = cut === null ? args : {
    station: sliceByDate(args.station, "0000-00-00", cut),
    premises: sliceByDate(args.premises, "0000-00-00", cut),
  };
  const replayWindow = cut === null ? args : {
    station: sliceByDate(args.station, cut),
    premises: sliceByDate(args.premises, cut),
  };

  const legs = sizeLegsFromHistory({
    rungs,
    curve: args.curve,
    station: sizingWindow.station,
    premises: sizingWindow.premises,
    ...monthArg,
  });
  if (legs.length === 0) {
    const inRegion = rungs.length;
    throw new Error(
      inRegion === 0
        ? `no rung on ${args.ladder.eventTicker} sits in the loss region (${args.curve.direction} ${args.curve.threshold})`
        : `${inRegion} rung(s) on ${args.ladder.eventTicker} sit in the loss region, but none paid on a day this business was hurting — the station is tracking something else`,
    );
  }
  const replay = backtest({
    legs,
    curve: args.curve,
    station: replayWindow.station,
    premises: replayWindow.premises,
    ...monthArg,
  });
  const premiumPerDayUsd = legs.reduce(
    (sum, leg) => sum + leg.contracts * leg.pricePerContract,
    0,
  );
  const worstDayLossUsd = -replay.worstDayUnhedged;
  const limitUsd = limitOf(legs);
  return {
    legs,
    premiumPerDayUsd,
    limitUsd,
    attachment: args.curve.threshold,
    direction: args.curve.direction,
    worstDayLossUsd,
    worstDayCovered:
      worstDayLossUsd === 0 ? 0 : Math.min(1, limitUsd / worstDayLossUsd),
    expectedLossRatio: replay.lossRatio,
    replay,
    outOfSample: cut !== null,
    unit: args.curve.unit,
    warnings: planWarnings({ curve: args.curve, replay, legs, outOfSample: cut !== null }),
  };
}

/** What this structure would pay if the station landed on a given value. */
export function payoutAt(plan: CoverPlan, value: number): number {
  let payout = 0;
  for (const leg of plan.legs) {
    const withinFloor = leg.strike.floor === null || value >= leg.strike.floor;
    const withinCap = leg.strike.cap === null || value <= leg.strike.cap;
    if (withinFloor && withinCap) payout += leg.contracts;
  }
  return payout;
}

/**
 * The shape a client should actually look at: what the day costs them, what the
 * cover returns, and what is left over, across the range of outcomes.
 *
 * A good structure makes the net column flat. That is the whole product in one
 * table, and it is far more legible than any single effectiveness score.
 */
export function coverProfile(
  plan: CoverPlan,
  curve: LossCurve,
  values: number[],
): Array<{ value: number; lossUsd: number; payoutUsd: number; netUsd: number }> {
  return values.map((value) => {
    const lossUsd = expectedLoss(curve, value);
    const payoutUsd = payoutAt(plan, value);
    return {
      value,
      lossUsd,
      payoutUsd,
      netUsd: payoutUsd - plan.premiumPerDayUsd - lossUsd,
    };
  });
}
