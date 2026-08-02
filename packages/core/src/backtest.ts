/**
 * Replaying a cover structure against the seasons that already happened.
 *
 * Every other number in this system is forward-looking: a fitted curve, a
 * scored basis, a quoted premium. None of them say whether the structure would
 * have worked. History does, and both halves are now available — the station
 * observations that decide whether a contract pays, and the premises
 * observations that decide whether the business was hurting.
 *
 * The result that matters is not profit. A hedge is supposed to lose money on
 * average; what it buys is a flatter year. So the headline number here is how
 * much the swing in daily outcomes shrank, with the loss ratio alongside it to
 * show what that cost.
 */
import { expectedLoss } from "./loss.js";
import type { LossCurve } from "./loss.js";
import type { DailySeries } from "./observations.js";
import type { Ladder, Strike, StrikeUnit } from "./types.js";

export interface CoverLeg {
  /** The rung's own bucket label, e.g. "70° or below". */
  label: string;
  strike: Strike;
  /** Contracts held on this rung for each day of the window. */
  contracts: number;
  /** What one contract costs, 0–1. */
  pricePerContract: number;
}

export interface BacktestArgs {
  legs: CoverLeg[];
  curve: LossCurve;
  /** Observations at the station the contracts settle on. */
  station: DailySeries;
  /** Observations at the business's own location. */
  premises: DailySeries;
  /** Calendar months (1–12) the business is exposed. Omit for the whole year. */
  months?: number[];
}

export interface BacktestResult {
  days: number;
  /** Dollars the business lost to weather over the window. */
  totalLoss: number;
  /** Dollars the cover would have paid out. */
  totalPayout: number;
  /** Dollars of premium spent to hold it. */
  totalPremium: number;
  /** Payouts ÷ premium. Below 1 means the cover cost more than it returned. */
  lossRatio: number | null;
  /** Share of the realized loss the payouts offset. */
  coveredFraction: number;
  /** Standard deviation of the daily outcome without cover. */
  swingUnhedged: number;
  /** Standard deviation of the daily outcome with cover. */
  swingHedged: number;
  /** How much the daily swing shrank, 0–1. Negative means cover added noise. */
  swingReduction: number;
  /** Worst single day, unhedged and hedged. */
  worstDayUnhedged: number;
  worstDayHedged: number;
  daysHurt: number;
  daysPaid: number;
  /** Days the business was hurting and the cover paid — realized trigger hit rate. */
  daysHurtAndPaid: number;
  realizedTriggerCorrelation: number;
  unit: StrikeUnit;
}

/** Does an observation fall inside a rung's (inclusive) bucket? */
export function bucketContains(strike: Strike, value: number): boolean {
  if (strike.floor !== null && value < strike.floor) return false;
  if (strike.cap !== null && value > strike.cap) return false;
  return true;
}

/**
 * The rungs whose bucket sits inside the region where the business actually
 * loses money — "buy the buckets your loss lives in", made concrete.
 *
 * A rung counts when any part of its bucket is past the threshold, since a
 * bucket straddling the kink still pays on days that hurt.
 */
export function selectLossRungs(ladder: Ladder, curve: LossCurve): Ladder["rungs"] {
  return ladder.rungs.filter((rung) => {
    const strike = rung.strike;
    if (!strike) return false;
    return curve.direction === "below"
      ? (strike.floor ?? Number.NEGATIVE_INFINITY) < curve.threshold
      : (strike.cap ?? Number.POSITIVE_INFINITY) > curve.threshold;
  });
}

/**
 * Size each rung to the loss it is actually standing in for.
 *
 * A contract pays $1 when the station lands in its bucket, so the number to
 * hold is the loss the business expects on exactly those days: the conditional
 * expectation of the loss given the station lands there, taken over history.
 * That is the replicating position — it pays what the day costs, no more.
 *
 * Sizing by hand is worse than it looks. Too few contracts and cover does
 * nothing; too many and the payout swamps the loss it was meant to offset, so
 * the position starts adding volatility instead of removing it. The optimum is
 * interior, and it is not guessable.
 */
export function sizeLegsFromHistory(args: {
  rungs: Ladder["rungs"];
  curve: LossCurve;
  station: DailySeries;
  premises: DailySeries;
  months?: number[];
}): CoverLeg[] {
  const days = alignDays({
    station: args.station,
    premises: args.premises,
    ...(args.months && { months: args.months }),
  });
  if (days.length === 0) {
    throw new Error("no overlapping days to size against");
  }
  const legs: CoverLeg[] = [];
  for (const rung of args.rungs) {
    const strike = rung.strike;
    if (!strike || rung.quotes.yesAsk <= 0) continue;
    const inBucket = days.filter((d) => bucketContains(strike, d.station));
    if (inBucket.length === 0) continue;
    const meanLoss =
      inBucket.reduce((sum, d) => sum + expectedLoss(args.curve, d.premises), 0) / inBucket.length;
    if (meanLoss <= 0) continue;
    legs.push({
      label: strike.label,
      strike,
      contracts: Math.round(meanLoss),
      pricePerContract: rung.quotes.yesAsk,
    });
  }
  return legs;
}

function standardDeviation(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const variance = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

interface AlignedDay {
  date: string;
  station: number;
  premises: number;
}

function alignDays(args: {
  station: DailySeries;
  premises: DailySeries;
  months?: number[];
}): AlignedDay[] {
  const months = args.months;
  const premisesByDate = new Map<string, number>();
  for (const [i, date] of args.premises.dates.entries()) {
    const value = args.premises.values[i];
    if (value !== null && value !== undefined) premisesByDate.set(date, value);
  }
  const days: AlignedDay[] = [];
  for (const [i, date] of args.station.dates.entries()) {
    const station = args.station.values[i];
    const premises = premisesByDate.get(date);
    if (station === null || station === undefined || premises === undefined) continue;
    if (months && months.length > 0) {
      const month = Number(date.slice(5, 7));
      if (!months.includes(month)) continue;
    }
    days.push({ date, station, premises });
  }
  return days;
}

function payoutFor(legs: CoverLeg[], stationValue: number): number {
  let payout = 0;
  for (const leg of legs) {
    if (bucketContains(leg.strike, stationValue)) payout += leg.contracts;
  }
  return payout;
}

/**
 * Replay the structure day by day.
 *
 * Premium is charged at today's quoted price on every day of the window, which
 * is a simplification: a real roll would pay whatever the market asked that
 * morning, and those prices move with the season. It biases the premium toward
 * whatever conditions are being quoted now, so treat the loss ratio as
 * indicative and the swing reduction — which depends only on realized weather —
 * as the solid number.
 */
export function backtest(args: BacktestArgs): BacktestResult {
  const days = alignDays(args);
  if (days.length === 0) {
    throw new Error(
      "no overlapping days to replay — check the date range and the seasonal month filter",
    );
  }
  const premiumPerDay = args.legs.reduce(
    (sum, leg) => sum + leg.contracts * leg.pricePerContract,
    0,
  );

  let totalLoss = 0;
  let totalPayout = 0;
  let daysHurt = 0;
  let daysPaid = 0;
  let daysHurtAndPaid = 0;
  const unhedged: number[] = [];
  const hedged: number[] = [];

  for (const day of days) {
    const loss = expectedLoss(args.curve, day.premises);
    const payout = payoutFor(args.legs, day.station);
    totalLoss += loss;
    totalPayout += payout;
    if (loss > 0) daysHurt += 1;
    if (payout > 0) daysPaid += 1;
    if (loss > 0 && payout > 0) daysHurtAndPaid += 1;
    unhedged.push(-loss);
    hedged.push(payout - premiumPerDay - loss);
  }

  const totalPremium = premiumPerDay * days.length;
  const swingUnhedged = standardDeviation(unhedged);
  const swingHedged = standardDeviation(hedged);
  return {
    days: days.length,
    totalLoss,
    totalPayout,
    totalPremium,
    lossRatio: totalPremium === 0 ? null : totalPayout / totalPremium,
    coveredFraction: totalLoss === 0 ? 0 : totalPayout / totalLoss,
    swingUnhedged,
    swingHedged,
    swingReduction: swingUnhedged === 0 ? 0 : 1 - swingHedged / swingUnhedged,
    worstDayUnhedged: Math.min(...unhedged),
    worstDayHedged: Math.min(...hedged),
    daysHurt,
    daysPaid,
    daysHurtAndPaid,
    realizedTriggerCorrelation: daysHurt === 0 ? 0 : daysHurtAndPaid / daysHurt,
    unit: args.station.unit,
  };
}

/** A plain reading of what the replay showed. */
export function describeBacktest(result: BacktestResult): string {
  if (result.daysHurt === 0) {
    return `Over ${result.days} days the business never crossed its loss threshold, so there was nothing for cover to do. Widen the window or revisit the curve.`;
  }
  const swing = Math.round(result.swingReduction * 100);
  const ratio = result.lossRatio === null ? "n/a" : result.lossRatio.toFixed(2);
  const direction = swing >= 0 ? "smoothed" : "added";
  return (
    `Across ${result.days} days it ${direction} ${Math.abs(swing)}% of the daily swing, ` +
    `offsetting $${Math.round(result.totalPayout).toLocaleString()} of $${Math.round(result.totalLoss).toLocaleString()} in weather losses ` +
    `for $${Math.round(result.totalPremium).toLocaleString()} of premium (loss ratio ${ratio}). ` +
    `It paid on ${result.daysHurtAndPaid} of the ${result.daysHurt} days that actually hurt, ` +
    `and the worst day went from -$${Math.round(-result.worstDayUnhedged).toLocaleString()} to -$${Math.round(-result.worstDayHedged).toLocaleString()}.`
  );
}
