import type { CoverQuote } from "./types.js";

/**
 * What the client is actually trying to protect — their real loss, not the
 * market's resolution criterion. The gap between the two is basis risk.
 */
export interface LossProfile {
  /** The real-world loss in the client's own words. */
  lossEvent: string;
  /** Dollars at risk if the loss event occurs. */
  exposureValueUsd: number;
  /** Start of the exposure window, ISO date (inclusive). */
  windowStart: string;
  /** End of the exposure window, ISO date (inclusive). */
  windowEnd: string;
}

export interface BasisInputs {
  /** The cover already priced against the candidate contract. */
  quote: CoverQuote;
  /** The client's real loss profile. */
  loss: LossProfile;
  /** Market resolution date (ISO) from `Market.endDate`; null if open-ended. */
  marketEndDate: string | null;
  /**
   * P(market pays out | the client's loss event occurs), in [0, 1]. This is
   * the core basis-risk assumption and must be an explicit, reasoned estimate —
   * never silently defaulted. 1 = the trigger and the real loss are the same
   * event; 0 = unrelated.
   */
  triggerCorrelation: number;
  /** One-line justification for the triggerCorrelation estimate. */
  correlationRationale: string;
}

export type BasisVerdict = "tight" | "workable" | "loose";

export interface BasisAssessment {
  triggerCorrelation: number;
  correlationRationale: string;
  /** [0, 1] — does the market resolve inside the exposure window? */
  tenorAlignment: number;
  /** [0, 1] — payout vs exposure, clamped at 1 for the effectiveness blend. */
  payoutCoverage: number;
  /** Raw maxPayout / exposure (may exceed 1). */
  rawCoverageRatio: number;
  /** ρ × τ × κ — share of the real loss this hedge actually neutralizes. */
  effectivenessScore: number;
  /** exposure × (1 − effectiveness) — dollars still exposed after the hedge. */
  residualRiskUsd: number;
  /** exposure × (1 − ρ) — dollars exposed purely to trigger mismatch. */
  basisRiskUsd: number;
  verdict: BasisVerdict;
  warnings: string[];
}

const DAY_MS = 86_400_000;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function parseDate(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`${label} is not a valid ISO date: ${value}`);
  }
  return ms;
}

/**
 * How well the market's resolution timing covers the exposure window. A market
 * that resolves inside the window pays out while the risk is live (1.0); one
 * that resolves before or after decays linearly over one window-length of
 * misalignment. Open-ended markets get partial credit and a warning.
 */
function tenorAlignment(input: BasisInputs): number {
  if (input.marketEndDate === null) return 0.5;
  const end = parseDate(input.marketEndDate, "marketEndDate");
  const start = parseDate(input.loss.windowStart, "windowStart");
  const close = parseDate(input.loss.windowEnd, "windowEnd");
  const windowLen = Math.max(DAY_MS, close - start);
  if (end >= start && end <= close) return 1;
  const drift = end > close ? end - close : start - end;
  return clamp01(1 - drift / windowLen);
}

function verdictFor(score: number): BasisVerdict {
  if (score >= 0.75) return "tight";
  if (score >= 0.5) return "workable";
  return "loose";
}

function basisWarnings(
  input: BasisInputs,
  tenor: number,
  rawCoverage: number,
): string[] {
  const out: string[] = [];
  if (input.triggerCorrelation < 0.6) {
    out.push(
      "High basis risk: the market trigger only loosely tracks the real loss event.",
    );
  }
  if (input.marketEndDate === null) {
    out.push("Market is open-ended — resolution timing is uncertain.");
  } else if (tenor < 0.95) {
    out.push("Tenor gap: the market resolves outside the exposure window.");
  }
  if (rawCoverage < 0.8) {
    out.push(
      `Underfunded: payout covers only ${Math.round(rawCoverage * 100)}% of exposure.`,
    );
  } else if (rawCoverage > 1.5) {
    out.push(
      `Overspending: payout is ${rawCoverage.toFixed(1)}× exposure — you can size down.`,
    );
  }
  return out;
}

/**
 * Score how much of the client's *real* loss a hedge actually neutralizes,
 * decomposing the gap from a naive coverage ratio into the three things that
 * make a prediction-market hedge imperfect: trigger correlation (basis risk),
 * resolution timing, and payout adequacy.
 */
export function computeBasisRisk(input: BasisInputs): BasisAssessment {
  const rho = input.triggerCorrelation;
  if (rho < 0 || rho > 1) {
    throw new Error(`triggerCorrelation must be in [0, 1], got ${rho}`);
  }
  const exposure = input.loss.exposureValueUsd;
  if (exposure <= 0) {
    throw new Error(`exposureValueUsd must be positive, got ${exposure}`);
  }
  const rawCoverage = input.quote.limitUsd / exposure;
  const payoutCoverage = clamp01(rawCoverage);
  const tenor = tenorAlignment(input);
  const effectiveness = rho * tenor * payoutCoverage;
  return {
    triggerCorrelation: rho,
    correlationRationale: input.correlationRationale,
    tenorAlignment: tenor,
    payoutCoverage,
    rawCoverageRatio: rawCoverage,
    effectivenessScore: effectiveness,
    residualRiskUsd: exposure * (1 - effectiveness),
    basisRiskUsd: exposure * (1 - rho),
    verdict: verdictFor(effectiveness),
    warnings: basisWarnings(input, tenor, rawCoverage),
  };
}

export interface BasketLeg {
  marketId: string;
  question: string;
  side: "Yes" | "No";
  /** Price of the chosen side, 0–1. */
  priceUsd: number;
  /** P(this leg pays out | the real loss event occurs), in [0, 1]. */
  triggerCorrelation: number;
  correlationRationale: string;
  /** Market's minimum order size in USDC, if known. */
  orderMinSizeUsd?: number;
}

export interface BasketAllocation {
  leg: BasketLeg;
  budgetUsd: number;
  contracts: number;
  limitUsd: number;
}

export interface BasketPlan {
  allocations: BasketAllocation[];
  totalBudgetUsd: number;
  totalMaxPayoutUsd: number;
  /**
   * Combined trigger coverage from diversifying across proxies, capped at 0.95.
   * Assumes the legs' basis errors are *independent* — if the proxies tend to
   * miss together, true coverage is lower. Always caveated in `warnings`.
   */
  combinedTriggerCoverage: number;
  combinedCoverageRatio: number | null;
  effectivenessScore: number | null;
  residualRiskUsd: number | null;
  warnings: string[];
}

const MAX_COMBINED_COVERAGE = 0.95;

function basketWarnings(allocations: BasketAllocation[]): string[] {
  const out: string[] = [
    "Combined coverage assumes the legs miss independently; if they're correlated, true coverage is lower.",
  ];
  if (allocations.length < 2) {
    out.push("A basket of one is just a single hedge — use computeBasisRisk.");
  }
  for (const a of allocations) {
    const min = a.leg.orderMinSizeUsd;
    if (min !== undefined && a.budgetUsd < min) {
      out.push(
        `Leg "${a.leg.question}" gets $${a.budgetUsd.toFixed(2)} but its order minimum is $${min} — drop it or raise the budget.`,
      );
    }
  }
  return out;
}

/**
 * Spread a budget across several imperfect proxy markets to track a loss the
 * client can't hedge cleanly with any single market. Budget is weighted toward
 * the better-correlated legs; combined coverage uses an independence assumption
 * (capped, caveated) so the basket never claims to be a perfect hedge.
 */
export function composeBasket(
  legs: BasketLeg[],
  totalBudgetUsd: number,
  exposureValueUsd?: number,
): BasketPlan {
  if (legs.length === 0) throw new Error("composeBasket needs at least one leg");
  if (totalBudgetUsd <= 0) {
    throw new Error(`totalBudgetUsd must be positive, got ${totalBudgetUsd}`);
  }
  const weightTotal = legs.reduce((sum, l) => sum + l.triggerCorrelation, 0);
  if (weightTotal <= 0) {
    throw new Error("at least one leg must have triggerCorrelation > 0");
  }
  const allocations = legs.map((leg): BasketAllocation => {
    if (leg.priceUsd <= 0 || leg.priceUsd >= 1) {
      throw new Error(
        `leg ${leg.marketId} price must be in (0, 1), got ${leg.priceUsd}`,
      );
    }
    const budget = totalBudgetUsd * (leg.triggerCorrelation / weightTotal);
    const shares = budget / leg.priceUsd;
    return { leg, budgetUsd: budget, contracts: shares, limitUsd: shares };
  });
  const totalPayout = allocations.reduce((s, a) => s + a.limitUsd, 0);
  const missProduct = legs.reduce((p, l) => p * (1 - l.triggerCorrelation), 1);
  const combinedCoverage = Math.min(MAX_COMBINED_COVERAGE, 1 - missProduct);
  const coverageRatio =
    exposureValueUsd && exposureValueUsd > 0
      ? totalPayout / exposureValueUsd
      : null;
  const effectiveness =
    coverageRatio === null
      ? null
      : combinedCoverage * Math.min(1, coverageRatio);
  return {
    allocations,
    totalBudgetUsd,
    totalMaxPayoutUsd: totalPayout,
    combinedTriggerCoverage: combinedCoverage,
    combinedCoverageRatio: coverageRatio,
    effectivenessScore: effectiveness,
    residualRiskUsd:
      effectiveness === null || exposureValueUsd === undefined
        ? null
        : exposureValueUsd * (1 - effectiveness),
    warnings: basketWarnings(allocations),
  };
}
