/**
 * Measuring geographic basis risk from observations.
 *
 * `estimateTriggerCorrelation` asks a model to score how well a contract's
 * location matches where the loss happens. That is a guess about a question
 * history can answer: over the last few years, how often did the settlement
 * station cross the trigger on the days the business was actually hurting?
 *
 * The answer is frequently worse than intuition suggests. Chicago's Midway
 * settlement point and the lakefront a few miles away routinely differ by
 * several degrees on the same afternoon, which is the difference between cover
 * that pays and cover that doesn't.
 */
import type { DailySeries } from "./observations.js";
import type { LossDirection } from "./loss.js";
import type { StrikeUnit } from "./types.js";

export interface GeoBasisMeasurement {
  /** Days where both places have an observation. */
  days: number;
  /** Pearson correlation between the two daily series. */
  correlation: number;
  /** Average absolute gap between the two places, in `unit`. */
  meanAbsDifference: number;
  /** Largest single-day gap observed, in `unit`. */
  maxAbsDifference: number;
  /**
   * P(the station crosses the trigger | the business was actually hurting).
   * This is the trigger correlation `computeBasisRisk` needs, measured rather
   * than estimated.
   */
  triggerCorrelation: number;
  /** Days the business's own weather crossed the threshold. */
  lossDays: number;
  /** Days the station paid out while the premises were fine. */
  falsePositiveDays: number;
  threshold: number;
  direction: LossDirection;
  unit: StrikeUnit;
}

interface AlignedPair {
  station: number;
  premises: number;
}

function alignByDate(station: DailySeries, premises: DailySeries): AlignedPair[] {
  const premisesByDate = new Map<string, number>();
  for (const [i, date] of premises.dates.entries()) {
    const value = premises.values[i];
    if (value !== null && value !== undefined) premisesByDate.set(date, value);
  }
  const pairs: AlignedPair[] = [];
  for (const [i, date] of station.dates.entries()) {
    const stationValue = station.values[i];
    const premisesValue = premisesByDate.get(date);
    if (stationValue !== null && stationValue !== undefined && premisesValue !== undefined) {
      pairs.push({ station: stationValue, premises: premisesValue });
    }
  }
  return pairs;
}

function pearson(pairs: AlignedPair[]): number {
  const n = pairs.length;
  const stationMean = pairs.reduce((s, p) => s + p.station, 0) / n;
  const premisesMean = pairs.reduce((s, p) => s + p.premises, 0) / n;
  let covariance = 0;
  let stationVariance = 0;
  let premisesVariance = 0;
  for (const p of pairs) {
    const ds = p.station - stationMean;
    const dp = p.premises - premisesMean;
    covariance += ds * dp;
    stationVariance += ds * ds;
    premisesVariance += dp * dp;
  }
  const denominator = Math.sqrt(stationVariance * premisesVariance);
  return denominator === 0 ? 0 : covariance / denominator;
}

function triggers(value: number, threshold: number, direction: LossDirection): boolean {
  return direction === "below" ? value < threshold : value > threshold;
}

/**
 * Compare the station a contract settles on against the business's own
 * location, and report how much of the loss the contract would actually have
 * caught.
 *
 * `triggerCorrelation` is deliberately conditioned on the loss having happened,
 * because that is the only case a hedge exists for. Days the station pays while
 * the business was fine are counted separately: they are not a failure of
 * cover, but they do mean the client is buying a trigger looser than their risk.
 */
export function measureGeographicBasis(args: {
  station: DailySeries;
  premises: DailySeries;
  threshold: number;
  direction: LossDirection;
}): GeoBasisMeasurement {
  const pairs = alignByDate(args.station, args.premises);
  if (pairs.length < 2) {
    throw new Error(
      `need at least 2 overlapping days to measure geographic basis, got ${pairs.length}`,
    );
  }
  let absDifferenceTotal = 0;
  let maxAbsDifference = 0;
  let lossDays = 0;
  let caughtDays = 0;
  let falsePositiveDays = 0;
  for (const pair of pairs) {
    const gap = Math.abs(pair.station - pair.premises);
    absDifferenceTotal += gap;
    maxAbsDifference = Math.max(maxAbsDifference, gap);
    const premisesHurt = triggers(pair.premises, args.threshold, args.direction);
    const stationPaid = triggers(pair.station, args.threshold, args.direction);
    if (premisesHurt) {
      lossDays += 1;
      if (stationPaid) caughtDays += 1;
    } else if (stationPaid) {
      falsePositiveDays += 1;
    }
  }
  return {
    days: pairs.length,
    correlation: pearson(pairs),
    meanAbsDifference: absDifferenceTotal / pairs.length,
    maxAbsDifference,
    triggerCorrelation: lossDays === 0 ? 0 : caughtDays / lossDays,
    lossDays,
    falsePositiveDays,
    threshold: args.threshold,
    direction: args.direction,
    unit: args.station.unit,
  };
}

/** One line a broker can say out loud about a measurement. */
export function describeGeoBasis(m: GeoBasisMeasurement): string {
  const unit = m.unit === "F" ? "°F" : (m.unit ?? "");
  if (m.lossDays === 0) {
    return `Over ${m.days} days the threshold never triggered at the business, so there is nothing to measure trigger correlation against. Widen the window or move the threshold.`;
  }
  const pct = Math.round(m.triggerCorrelation * 100);
  return (
    `Over ${m.days} days the station ran ${m.meanAbsDifference.toFixed(1)}${unit} from the premises on average ` +
    `(worst day ${m.maxAbsDifference.toFixed(1)}${unit}). It crossed the trigger on ${pct}% of the ${m.lossDays} days ` +
    `the business was actually hurting, and paid on ${m.falsePositiveDays} days it wasn't.`
  );
}
