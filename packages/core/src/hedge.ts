import type { HedgeQuote, Market } from "./types.js";

export interface HedgeArgs {
  yesPriceUsdc: number;
  costBudgetUsdc: number;
  exposureValueUsdc?: number;
}

export function computeHedge(args: HedgeArgs): HedgeQuote {
  const { yesPriceUsdc, costBudgetUsdc, exposureValueUsdc } = args;
  if (yesPriceUsdc <= 0 || yesPriceUsdc >= 1) {
    throw new Error(
      `yesPriceUsdc must be between 0 and 1 exclusive, got ${yesPriceUsdc}`,
    );
  }
  if (costBudgetUsdc <= 0) {
    throw new Error(`costBudgetUsdc must be positive, got ${costBudgetUsdc}`);
  }
  const sharesAffordable = costBudgetUsdc / yesPriceUsdc;
  const maxPayoutUsdc = sharesAffordable;
  const profitIfYesUsdc = maxPayoutUsdc - costBudgetUsdc;
  const roiIfYesPct = (profitIfYesUsdc / costBudgetUsdc) * 100;
  const coverageRatio =
    exposureValueUsdc && exposureValueUsdc > 0
      ? maxPayoutUsdc / exposureValueUsdc
      : null;
  return {
    yesPriceUsdc,
    costBudgetUsdc,
    sharesAffordable,
    maxPayoutUsdc,
    profitIfYesUsdc,
    roiIfYesPct,
    roiIfNoPct: -100,
    exposureValueUsdc: exposureValueUsdc ?? null,
    coverageRatio,
  };
}

export function quoteFromMarket(
  market: Market,
  side: "Yes" | "No",
  costBudgetUsdc: number,
  exposureValueUsdc?: number,
): HedgeQuote {
  const idx = market.outcomes.findIndex(
    (o) => o.toLowerCase() === side.toLowerCase(),
  );
  if (idx === -1) {
    throw new Error(
      `market ${market.id} has no '${side}' outcome (got: ${market.outcomes.join(", ")})`,
    );
  }
  const price = market.outcomePrices[idx];
  if (price === undefined) {
    throw new Error(`market ${market.id} has no price for outcome ${side}`);
  }
  return computeHedge({
    yesPriceUsdc: price,
    costBudgetUsdc,
    ...(exposureValueUsdc !== undefined && { exposureValueUsdc }),
  });
}
