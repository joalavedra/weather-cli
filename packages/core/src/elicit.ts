/**
 * Loss-function elicitation. The hardest input to `computeBasisRisk` is the
 * trigger correlation — P(market pays out | the client's loss actually
 * happens). Eyeballing it as a single number hides the reasoning. This module
 * decomposes it into the dimensions a market can mismatch the real loss on, so
 * the estimate is auditable and the weakest link is explicit.
 */

export interface CorrelationFactor {
  /** 0–1: how well this dimension of the market matches the real loss. */
  score: number;
  /** One-line justification for the score. */
  note: string;
}

export interface CorrelationFactors {
  /** Does the market's location match where the loss occurs? */
  geographic: CorrelationFactor;
  /** Does the market measure the same physical peril that drives the loss? */
  peril: CorrelationFactor;
  /** Does the market's trigger threshold match where the loss actually bites? */
  threshold: CorrelationFactor;
}

export interface CorrelationEstimate {
  /** Combined P(market pays | loss happens), 0–1. */
  value: number;
  /** Auto-composed rationale summarizing the factor breakdown. */
  rationale: string;
  factors: CorrelationFactors;
  /** The dimension dragging correlation down the most. */
  weakest: keyof CorrelationFactors;
}

const FACTOR_LABELS: Record<keyof CorrelationFactors, string> = {
  geographic: "geographic",
  peril: "peril",
  threshold: "threshold",
};

function validate(name: string, factor: CorrelationFactor): void {
  if (factor.score < 0 || factor.score > 1) {
    throw new Error(`${name} score must be in [0, 1], got ${factor.score}`);
  }
  if (factor.note.trim() === "") {
    throw new Error(`${name} factor needs a non-empty note`);
  }
}

/**
 * Combine the per-dimension match scores into a single trigger correlation.
 *
 * The product is deliberate: a market only pays on the client's loss if it
 * matches on *every* dimension at once (right place AND right peril AND right
 * threshold), so a mismatch on any one compounds rather than averages out.
 * This is conservative by design — it surfaces basis risk instead of smoothing
 * it away — and the returned rationale names the weakest link.
 */
export function estimateTriggerCorrelation(
  factors: CorrelationFactors,
): CorrelationEstimate {
  const entries = Object.entries(factors) as Array<
    [keyof CorrelationFactors, CorrelationFactor]
  >;
  for (const [key, factor] of entries) validate(FACTOR_LABELS[key], factor);
  const value = entries.reduce((acc, [, f]) => acc * f.score, 1);
  const weakest = entries.reduce((lo, e) =>
    e[1].score < lo[1].score ? e : lo,
  )[0];
  const breakdown = entries
    .map(([key, f]) => `${FACTOR_LABELS[key]} ${Math.round(f.score * 100)}%`)
    .join(", ");
  const rationale = `${breakdown} → ${Math.round(value * 100)}% combined; weakest link: ${FACTOR_LABELS[weakest]} (${factors[weakest].note}).`;
  return { value, rationale, factors, weakest };
}
