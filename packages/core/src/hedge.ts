import type { CoverQuote, Market } from "./types.js";

export interface PriceCoverArgs {
  /** Price of one contract on the side being bought, 0–1 exclusive. */
  pricePerContract: number;
  /** Premium the client will pay. */
  premiumUsdc: number;
  /** Dollars at risk if the loss happens. Enables the exposure invariant. */
  exposureUsdc?: number;
}

/**
 * Slack allowed above stated exposure before a position stops being cover.
 * Exposure is itself an estimate, so an exact cap would reject sound structures
 * over rounding.
 */
const EXPOSURE_TOLERANCE = 1.05;

/**
 * The line between cover and a bet.
 *
 * A position that pays more than the loss it protects is a directional trade on
 * the weather wearing an insurance label, and the backtest shows this isn't
 * pedantry: past the point where payout matches loss, the position starts
 * adding volatility to the year rather than removing it. It is enforced here
 * rather than asked for in a prompt, because a rule a model can talk itself out
 * of is not a rule.
 */
function assertWithinExposure(
  limitUsdc: number,
  exposureUsdc: number,
  pricePerContract: number,
): void {
  if (limitUsdc <= exposureUsdc * EXPOSURE_TOLERANCE) return;
  const maxPremium = exposureUsdc * pricePerContract;
  throw new Error(
    `this position would pay $${limitUsdc.toFixed(2)} against $${exposureUsdc.toFixed(2)} of exposure, ` +
      `which is a bet rather than cover. Cap the premium at $${maxPremium.toFixed(2)} to cover the exposure exactly.`,
  );
}

/**
 * Price cover on a single contract.
 *
 * The framing is insurance rather than trading, and the difference is not
 * cosmetic. There is no "return" here: premium spent in a season where the
 * weather cooperated is the cost of not carrying the risk, and reporting it as
 * a -100% ROI invites a client to judge cover the way they would judge a bet.
 */
export function priceCover(args: PriceCoverArgs): CoverQuote {
  const { pricePerContract, premiumUsdc, exposureUsdc } = args;
  if (pricePerContract <= 0 || pricePerContract >= 1) {
    throw new Error(
      `pricePerContract must be between 0 and 1 exclusive, got ${pricePerContract} — a contract at 0 or 1 has no live market`,
    );
  }
  if (premiumUsdc <= 0) {
    throw new Error(`premiumUsdc must be positive, got ${premiumUsdc}`);
  }
  const contracts = premiumUsdc / pricePerContract;
  const limitUsdc = contracts;
  if (exposureUsdc !== undefined && exposureUsdc > 0) {
    assertWithinExposure(limitUsdc, exposureUsdc, pricePerContract);
  }
  return {
    pricePerContract,
    premiumUsdc,
    contracts,
    limitUsdc,
    netIfTriggeredUsdc: limitUsdc - premiumUsdc,
    exposureUsdc: exposureUsdc ?? null,
    coverageRatio:
      exposureUsdc !== undefined && exposureUsdc > 0 ? limitUsdc / exposureUsdc : null,
  };
}

/** The largest premium that still keeps the payout inside stated exposure. */
export function maxPremiumForExposure(pricePerContract: number, exposureUsdc: number): number {
  return exposureUsdc * pricePerContract;
}

export function quoteFromMarket(
  market: Market,
  side: "Yes" | "No",
  premiumUsdc: number,
  exposureUsdc?: number,
): CoverQuote {
  const index = market.outcomes.findIndex((o) => o.toLowerCase() === side.toLowerCase());
  if (index === -1) {
    throw new Error(
      `market ${market.id} has no '${side}' outcome (got: ${market.outcomes.join(", ")})`,
    );
  }
  const price = market.outcomePrices[index];
  if (price === undefined) {
    throw new Error(`market ${market.id} has no price for outcome ${side}`);
  }
  return priceCover({
    pricePerContract: price,
    premiumUsdc,
    ...(exposureUsdc !== undefined && { exposureUsdc }),
  });
}
