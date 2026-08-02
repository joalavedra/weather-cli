/**
 * Fitting a business's loss curve to weather.
 *
 * The hardest input in the system is how much a business actually loses when
 * the weather turns. Asking the owner produces a round number they half
 * remember ("we're down about 20% when it's cold"), and every downstream
 * calculation inherits that guess. Their own daily revenue, paired against the
 * weather on the same days, answers it directly.
 *
 * The model is a hockey stick: revenue is flat while the weather is fine, then
 * falls at a constant rate once it crosses a threshold. That shape is chosen
 * because it is how these businesses actually describe the loss — "below about
 * 70 nobody comes" — and because its two parameters map straight onto the two
 * things cover needs: where the trigger belongs, and how many dollars a degree
 * is worth.
 */
import type { DailySeries } from "./observations.js";
import type { StrikeUnit } from "./types.js";

/** Which side of the threshold hurts: cold days, or hot ones. */
export type LossDirection = "below" | "above";

export interface RevenueDay {
  /** ISO date. */
  date: string;
  revenue: number;
}

export interface LossSample {
  value: number;
  revenue: number;
}

export interface LossCurve {
  direction: LossDirection;
  /** Where the loss starts biting, in `unit`. */
  threshold: number;
  /**
   * Dollars of revenue lost per unit beyond the threshold. Positive means the
   * weather hurts; negative means the fit says it helps, which is worth
   * surfacing rather than hiding.
   */
  slopePerUnit: number;
  /** Revenue on a day the weather isn't hurting. */
  baseline: number;
  /** Share of revenue variance the weather explains, 0–1. */
  rSquared: number;
  observations: number;
  unit: StrikeUnit;
}

/** Below this, weather isn't a big enough driver to buy cover against. */
const WEAK_FIT_R_SQUARED = 0.15;

const MIN_OBSERVATIONS = 30;

function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** The hinge feature: how far past the threshold a day fell, else zero. */
function hinge(value: number, threshold: number, direction: LossDirection): number {
  return direction === "below"
    ? Math.max(0, threshold - value)
    : Math.max(0, value - threshold);
}

interface Fit {
  intercept: number;
  slope: number;
  sse: number;
}

/**
 * Least squares for `revenue = intercept + slope × hinge` at a fixed threshold.
 * Returns null when every day falls on the same side of the threshold, since
 * the hinge is then constant and the slope is unidentifiable.
 */
function fitAtThreshold(
  samples: LossSample[],
  threshold: number,
  direction: LossDirection,
): Fit | null {
  const hinges = samples.map((s) => hinge(s.value, threshold, direction));
  const revenues = samples.map((s) => s.revenue);
  const hingeMean = mean(hinges);
  const revenueMean = mean(revenues);
  let covariance = 0;
  let variance = 0;
  for (const [i, h] of hinges.entries()) {
    const dh = h - hingeMean;
    covariance += dh * ((revenues[i] ?? 0) - revenueMean);
    variance += dh * dh;
  }
  if (variance === 0) return null;
  const slope = covariance / variance;
  const intercept = revenueMean - slope * hingeMean;
  let sse = 0;
  for (const [i, h] of hinges.entries()) {
    const residual = (revenues[i] ?? 0) - (intercept + slope * h);
    sse += residual * residual;
  }
  return { intercept, slope, sse };
}

/** Most distinct thresholds worth scanning before the search is subsampled. */
const MAX_THRESHOLD_CANDIDATES = 200;

/**
 * Candidate thresholds: every distinct observed value inside the 10th–90th
 * percentile band.
 *
 * The band keeps the search off the tails, where only a handful of days sit
 * beyond the kink and the slope is fit to noise. Within the band every value is
 * tried, because quantizing the grid can miss the true threshold outright —
 * temperature thresholds land on whole degrees, and a percentile grid can skip
 * the exact degree that matters. Continuous underlyings with many distinct
 * readings are subsampled evenly to bound the search.
 */
function candidateThresholds(values: number[]): number[] {
  const sorted = values.toSorted((a, b) => a - b);
  const low = sorted[Math.floor(0.1 * (sorted.length - 1))];
  const high = sorted[Math.floor(0.9 * (sorted.length - 1))];
  if (low === undefined || high === undefined) return [];
  const distinct = [...new Set(sorted.filter((v) => v >= low && v <= high))];
  if (distinct.length <= MAX_THRESHOLD_CANDIDATES) return distinct;
  const stride = distinct.length / MAX_THRESHOLD_CANDIDATES;
  return Array.from(
    { length: MAX_THRESHOLD_CANDIDATES },
    (_, i) => distinct[Math.floor(i * stride)] as number,
  );
}

/**
 * Fit the threshold and slope that best explain revenue from the weather.
 *
 * Both directions are tried when the caller doesn't specify one, and the better
 * fit wins — an owner who says "the cold kills us" is sometimes describing a
 * business that actually suffers in heat.
 */
export function fitLossCurve(
  samples: LossSample[],
  unit: StrikeUnit,
  direction?: LossDirection,
): LossCurve {
  if (samples.length < MIN_OBSERVATIONS) {
    throw new Error(
      `need at least ${MIN_OBSERVATIONS} paired days to fit a loss curve, got ${samples.length}`,
    );
  }
  const revenues = samples.map((s) => s.revenue);
  const revenueMean = mean(revenues);
  const totalSquares = revenues.reduce((sum, r) => sum + (r - revenueMean) ** 2, 0);
  if (totalSquares === 0) {
    throw new Error("revenue is identical on every day — nothing to explain");
  }
  const directions: LossDirection[] = direction ? [direction] : ["below", "above"];
  const thresholds = candidateThresholds(samples.map((s) => s.value));

  let best: LossCurve | null = null;
  for (const dir of directions) {
    for (const threshold of thresholds) {
      const fit = fitAtThreshold(samples, threshold, dir);
      if (!fit) continue;
      const rSquared = 1 - fit.sse / totalSquares;
      if (best !== null && rSquared <= best.rSquared) continue;
      best = {
        direction: dir,
        threshold,
        slopePerUnit: -fit.slope,
        baseline: fit.intercept,
        rSquared,
        observations: samples.length,
        unit,
      };
    }
  }
  if (!best) {
    throw new Error("could not fit a loss curve — the weather barely varies over this period");
  }
  return best;
}

/** Dollars this business expects to lose on a day with the given observation. */
export function expectedLoss(curve: LossCurve, value: number): number {
  return Math.max(0, curve.slopePerUnit * hinge(value, curve.threshold, curve.direction));
}

/**
 * A plain-language read on whether cover is worth buying at all.
 *
 * A weak fit is the most useful thing this module can report: it means weather
 * is not what's moving the till, and selling cover against it would be selling
 * a hedge for a risk the business doesn't have.
 */
export function describeFit(curve: LossCurve): string {
  const pct = Math.round(curve.rSquared * 100);
  const unit = curve.unit === "F" ? "°F" : (curve.unit ?? "unit");
  if (curve.slopePerUnit <= 0) {
    return `This weather doesn't hurt this business — if anything revenue rises past ${curve.threshold}${unit}. Cover isn't warranted.`;
  }
  if (curve.rSquared < WEAK_FIT_R_SQUARED) {
    return `Weather explains only ${pct}% of revenue swings here. Something else is driving the business, and cover would hedge a risk it doesn't really have.`;
  }
  return `Below ${curve.threshold}${unit} this business loses about $${curve.slopePerUnit.toFixed(0)} per ${unit}, and weather explains ${pct}% of revenue swings.`;
}

/**
 * Pair daily revenue with the observation for the same date. Days missing from
 * either side are dropped rather than interpolated: a fabricated observation
 * would flow straight into the threshold estimate.
 */
export function alignSamples(revenue: RevenueDay[], series: DailySeries): LossSample[] {
  const observed = new Map<string, number>();
  for (const [i, date] of series.dates.entries()) {
    const value = series.values[i];
    if (value !== null && value !== undefined) observed.set(date, value);
  }
  const samples: LossSample[] = [];
  for (const day of revenue) {
    const value = observed.get(day.date);
    if (value !== undefined && Number.isFinite(day.revenue)) {
      samples.push({ value, revenue: day.revenue });
    }
  }
  return samples;
}
