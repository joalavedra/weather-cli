import { tool } from "ai";
import { z } from "zod";
import {
  composeBasket,
  computeBasisRisk,
  computeHedge,
  estimateTriggerCorrelation,
  createWallet,
  fetchCityMarkets,
  fetchWeatherMarkets,
  getMarket,
  getPositions,
  getWalletStatus,
  listAvailableCities,
  placeMarketOrder,
  quoteFromMarket,
  runApprovals,
  searchMarkets,
} from "@weather/core";
import type { BasketLeg, Market } from "@weather/core";

const MAX_RESULTS = 8;

function summarize<
  T extends {
    id: string;
    question: string;
    slug: string;
    category: string;
    city: string | null;
    liquidity: number;
    outcomes: string[];
    outcomePrices: number[];
    endDate: string | null;
    url: string;
    clobTokenIds: string[];
    acceptingOrders: boolean;
    orderMinSize: number;
  },
>(m: T) {
  return {
    id: m.id,
    slug: m.slug,
    question: m.question,
    category: m.category,
    city: m.city,
    liquidity: Math.round(m.liquidity),
    outcomes: m.outcomes,
    outcomePrices: m.outcomePrices.map((p) => Number(p.toFixed(4))),
    endDate: m.endDate,
    url: m.url,
    clobTokenIds: m.clobTokenIds,
    acceptingOrders: m.acceptingOrders,
    orderMinSize: m.orderMinSize,
  };
}

function summarizeRaw(m: Market) {
  return {
    id: m.id,
    slug: m.slug,
    question: m.question,
    liquidity: Math.round(m.liquidity),
    outcomes: m.outcomes,
    outcomePrices: m.outcomePrices.map((p) => Number(p.toFixed(4))),
    endDate: m.endDate,
    url: m.url,
    clobTokenIds: m.clobTokenIds,
    acceptingOrders: m.acceptingOrders,
    orderMinSize: m.orderMinSize,
  };
}

export const searchWeatherMarketsTool = tool({
  description:
    "Search currently active *weather* markets on Polymarket (temperature, hurricane, tornado, space-weather, etc.). Optionally filter by city. Returns up to 8 markets sorted by liquidity. Use this only for weather-related hedges. For any other risk (politics, sports, crypto, macro, business events) use `search_markets` instead.",
  inputSchema: z.object({
    city: z
      .string()
      .optional()
      .describe(
        "Optional city name to filter (e.g. 'Tokyo', 'Madrid'). Leave empty for all weather markets.",
      ),
  }),
  execute: async ({ city }) => {
    const markets = city
      ? await fetchCityMarkets(city)
      : await fetchWeatherMarkets();
    return { markets: markets.slice(0, MAX_RESULTS).map(summarize) };
  },
});

export const searchMarketsTool = tool({
  description:
    "Search active Polymarket markets by free-text keyword. Use for any non-weather hedge: elections, politics, sports outcomes (game results, league winners, suspensions), crypto/macro (BTC/ETH price levels, Fed rate decisions, CPI prints), geopolitics (ceasefires, sanctions, regime change), business events (M&A, earnings, regulatory approvals, product launches), entertainment, etc. Returns up to 8 markets sorted by Polymarket relevance. Pick keywords that match how Polymarket would phrase the market title.",
  inputSchema: z.object({
    keyword: z
      .string()
      .min(2)
      .describe(
        "Search keyword — e.g. 'bitcoin 100k', 'fed rate cut december', 'ceasefire ukraine', 'super bowl', 'trump impeachment'.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Max results (default 8)."),
  }),
  execute: async ({ keyword, limit }) => {
    const results = await searchMarkets(keyword, limit ?? MAX_RESULTS);
    return { markets: results.slice(0, limit ?? MAX_RESULTS).map(summarizeRaw) };
  },
});

export const listCitiesTool = tool({
  description:
    "List the cities that currently have tradeable temperature markets on Polymarket, with market counts and total liquidity. Use this when the user is unsure which cities are covered.",
  inputSchema: z.object({}),
  execute: async () => {
    const markets = await fetchWeatherMarkets();
    return { cities: listAvailableCities(markets) };
  },
});

export const getMarketTool = tool({
  description:
    "Fetch full details for a single market by slug or ID, including the description and exact current prices. Use this before recommending a specific trade.",
  inputSchema: z.object({
    idOrSlug: z.string().describe("The market slug or ID."),
  }),
  execute: async ({ idOrSlug }) => {
    const market = await getMarket(idOrSlug);
    return {
      market: {
        id: market.id,
        slug: market.slug,
        question: market.question,
        description: market.description,
        liquidity: Math.round(market.liquidity),
        volume: Math.round(market.volume),
        outcomes: market.outcomes,
        outcomePrices: market.outcomePrices.map((p) => Number(p.toFixed(4))),
        endDate: market.endDate,
        url: market.url,
        clobTokenIds: market.clobTokenIds,
        acceptingOrders: market.acceptingOrders,
        orderMinSize: market.orderMinSize,
      },
    };
  },
});

export const computeHedgeQuoteTool = tool({
  description:
    "Compute a concrete hedge quote for a market: how many shares the budget buys, max payout, profit if it triggers, ROI both ways, and coverage ratio against the user's stated exposure. Always run this before recommending a trade.",
  inputSchema: z.object({
    idOrSlug: z.string().describe("The market slug or ID to quote against."),
    side: z
      .enum(["Yes", "No"])
      .describe(
        "Which outcome to BUY. Buy YES if the trigger you want to hedge against would resolve YES.",
      ),
    budgetUsdc: z.number().positive().describe("USDC the user will spend."),
    exposureValueUsdc: z
      .number()
      .positive()
      .optional()
      .describe(
        "Total value at risk in USDC if the bad outcome happens (used to compute coverage ratio).",
      ),
  }),
  execute: async ({ idOrSlug, side, budgetUsdc, exposureValueUsdc }) => {
    const market = await getMarket(idOrSlug);
    const quote = quoteFromMarket(market, side, budgetUsdc, exposureValueUsdc);
    return {
      market: {
        id: market.id,
        slug: market.slug,
        question: market.question,
        url: market.url,
        endDate: market.endDate,
      },
      side,
      quote,
    };
  },
});

const factorSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(1)
    .describe("0–1: how well this dimension matches the real loss."),
  note: z.string().min(1).describe("One line justifying the score."),
});

export const estimateCorrelationTool = tool({
  description:
    "Derive the trigger correlation for a hedge by decomposing it instead of eyeballing one number. The market only pays on the client's loss if it matches on EVERY dimension at once, so scores multiply (a mismatch on any one compounds). Score each dimension 0–1 with a note: `geographic` (does the market's location match where the loss occurs?), `peril` (does it measure the same physical peril that drives the loss?), `threshold` (does its trigger level match where the loss actually bites?). Returns the combined correlation, an auto-written rationale, and the weakest link. Run this before assess_basis_risk whenever the correlation isn't obvious, then pass the returned value + rationale into assess_basis_risk.",
  inputSchema: z.object({
    geographic: factorSchema.describe(
      "Location match — same site/metro = high, different region = low.",
    ),
    peril: factorSchema.describe(
      "Peril match — same physical driver of the loss = high.",
    ),
    threshold: factorSchema.describe(
      "Threshold match — market trigger level vs where the loss actually starts.",
    ),
  }),
  execute: ({ geographic, peril, threshold }) => {
    return {
      estimate: estimateTriggerCorrelation({ geographic, peril, threshold }),
    };
  },
});

export const assessBasisRiskTool = tool({
  description:
    "Score how much of the client's REAL loss a hedge actually neutralizes — not just the payout/exposure ratio. Decomposes the gap into trigger correlation (basis risk), resolution timing vs the risk window, and payout adequacy. Returns the sized quote plus an effectiveness score, the dollars still exposed, and the dollars exposed purely to trigger mismatch. Run this after compute_hedge_quote whenever the market is a PROXY for the real loss (almost always). You must supply triggerCorrelation as an explicit, reasoned estimate of P(this market pays out | the client's loss actually happens) — never guess silently; state your reasoning in correlationRationale.",
  inputSchema: z.object({
    idOrSlug: z.string().describe("The market slug or ID to assess."),
    side: z.enum(["Yes", "No"]).describe("Which outcome to BUY."),
    budgetUsdc: z.number().positive().describe("USDC the client will spend."),
    exposureValueUsdc: z
      .number()
      .positive()
      .describe("Dollars at risk if the real loss event happens."),
    lossEvent: z
      .string()
      .describe("The client's real loss in their words, e.g. 'warehouse road freezes shut'."),
    windowStart: z
      .string()
      .describe("Start of the exposure window, ISO date (YYYY-MM-DD)."),
    windowEnd: z
      .string()
      .describe("End of the exposure window, ISO date (YYYY-MM-DD)."),
    triggerCorrelation: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "P(this market pays out | the client's loss event occurs), 0–1. 1 = the market trigger IS the loss; lower = looser proxy.",
      ),
    correlationRationale: z
      .string()
      .describe("One line justifying the triggerCorrelation estimate."),
  }),
  execute: async ({
    idOrSlug,
    side,
    budgetUsdc,
    exposureValueUsdc,
    lossEvent,
    windowStart,
    windowEnd,
    triggerCorrelation,
    correlationRationale,
  }) => {
    const market = await getMarket(idOrSlug);
    const quote = quoteFromMarket(market, side, budgetUsdc, exposureValueUsdc);
    const basis = computeBasisRisk({
      quote,
      loss: { lossEvent, exposureValueUsdc, windowStart, windowEnd },
      marketEndDate: market.endDate,
      triggerCorrelation,
      correlationRationale,
    });
    return {
      market: {
        id: market.id,
        slug: market.slug,
        question: market.question,
        url: market.url,
        endDate: market.endDate,
      },
      side,
      quote,
      basis,
    };
  },
});

export const composeBasketTool = tool({
  description:
    "When no single market tracks the client's loss well (a loose basis-risk verdict), spread the budget across 2–4 proxy markets that miss in different ways, to cover more of the real loss than any one market can. Budget is weighted toward the better-correlated legs. Each leg needs its own triggerCorrelation estimate and rationale. Combined coverage assumes the legs' misses are independent and is capped below 1 — surface that caveat to the client. Fetches live prices for each market.",
  inputSchema: z.object({
    totalBudgetUsdc: z
      .number()
      .positive()
      .describe("Total USDC to spread across the basket."),
    exposureValueUsdc: z
      .number()
      .positive()
      .optional()
      .describe("Dollars at risk, for combined coverage and residual."),
    legs: z
      .array(
        z.object({
          idOrSlug: z.string().describe("Market slug or ID for this leg."),
          side: z.enum(["Yes", "No"]).describe("Outcome to buy for this leg."),
          triggerCorrelation: z
            .number()
            .min(0)
            .max(1)
            .describe("P(this leg pays out | the real loss occurs), 0–1."),
          correlationRationale: z
            .string()
            .describe("Why this leg is a useful proxy."),
        }),
      )
      .min(2)
      .max(4)
      .describe("2–4 proxy legs that fail in different ways."),
  }),
  execute: async ({ totalBudgetUsdc, exposureValueUsdc, legs }) => {
    const resolved: BasketLeg[] = await Promise.all(
      legs.map(async (l): Promise<BasketLeg> => {
        const market = await getMarket(l.idOrSlug);
        const idx = market.outcomes.findIndex(
          (o) => o.toLowerCase() === l.side.toLowerCase(),
        );
        const price = market.outcomePrices[idx];
        if (price === undefined) {
          throw new Error(
            `market ${l.idOrSlug} has no '${l.side}' outcome price`,
          );
        }
        return {
          marketId: market.id,
          question: market.question,
          side: l.side,
          priceUsdc: price,
          triggerCorrelation: l.triggerCorrelation,
          correlationRationale: l.correlationRationale,
          orderMinSizeUsdc: market.orderMinSize,
        };
      }),
    );
    return {
      plan: composeBasket(resolved, totalBudgetUsdc, exposureValueUsdc),
    };
  },
});

export const whatIfTool = tool({
  description:
    "Compute a quote from raw inputs without fetching a market. Useful for what-if scenarios.",
  inputSchema: z.object({
    yesPriceUsdc: z.number().min(0.001).max(0.999),
    budgetUsdc: z.number().positive(),
    exposureValueUsdc: z.number().positive().optional(),
  }),
  execute: ({ yesPriceUsdc, budgetUsdc, exposureValueUsdc }) => {
    return {
      quote: computeHedge({
        yesPriceUsdc,
        costBudgetUsdc: budgetUsdc,
        ...(exposureValueUsdc !== undefined && { exposureValueUsdc }),
      }),
    };
  },
});

export const walletStatusTool = tool({
  description:
    "Check the broker's Polymarket trading wallet: whether it's configured, address, USDC balance in cents, on-chain approvals state, and geoblock status. Always call this first before discussing trade execution. If `configured` is false, call `setup_wallet`. If approvals are not ready, call `run_approvals` after the user has funded MATIC.",
  inputSchema: z.object({}),
  execute: async () => {
    const status = await getWalletStatus();
    return {
      configured: status.configured,
      address: status.address,
      proxyAddress: status.proxyAddress,
      signatureType: status.signatureType,
      usdcBalanceUsd:
        status.usdcBalanceCents !== null
          ? status.usdcBalanceCents / 100
          : null,
      approvalsReady: status.approvalsReady,
      geoblocked: status.geoblocked,
    };
  },
});

export const setupWalletTool = tool({
  description:
    "Generate a brand-new Polymarket trading wallet (random private key, saved locally to ~/.config/polymarket/config.json). Only call this when wallet_status returns configured=false AND the user has explicitly asked you to create a wallet. Returns the new wallet address. After this, the user must fund the address with USDC + a small amount of MATIC on Polygon before approvals or trades will work.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await createWallet();
    return {
      address: result.address,
      message:
        "Wallet created. Send USDC and a small amount of MATIC (for gas) to this address on Polygon, then ask me to run approvals.",
    };
  },
});

export const runApprovalsTool = tool({
  description:
    "Send the on-chain approval transactions Polymarket needs before trading (USDC + CTF token approvals). Sends ~6 transactions on Polygon and requires MATIC for gas. Only call after wallet_status confirms the wallet is configured and the user confirms they have MATIC + want to proceed. Takes up to a few minutes.",
  inputSchema: z.object({}),
  execute: async () => {
    await runApprovals();
    return { ok: true, message: "Approvals submitted." };
  },
});

export const placeOrderTool = tool({
  description:
    "Place a market-buy order on Polymarket using the configured wallet. `tokenId` is the YES or NO clobTokenId for the chosen outcome (clobTokenIds[0]=YES, clobTokenIds[1]=NO). `amountUsdc` is how much USDC to spend (must be >= the market's orderMinSize, typically $1-5). Only call after the user has explicitly confirmed the trade in chat — never place orders speculatively. Returns the order ID and fill status.",
  inputSchema: z.object({
    tokenId: z.string().describe("The clobTokenId for the outcome to buy."),
    amountUsdc: z
      .number()
      .positive()
      .describe("USDC to spend on the buy order."),
    marketQuestion: z
      .string()
      .describe(
        "The market question, used only for echoing back to the user in the result.",
      ),
    side: z
      .enum(["Yes", "No"])
      .describe("Which outcome is being bought, for the result echo."),
  }),
  execute: async ({ tokenId, amountUsdc, marketQuestion, side }) => {
    const result = await placeMarketOrder({
      tokenId,
      side: "buy",
      amountUsdc,
    });
    return {
      orderId: result.orderId,
      status: result.status,
      filled: result.filled,
      marketQuestion,
      side,
      amountUsdc,
    };
  },
});

export const getPositionsTool = tool({
  description:
    "Read the broker wallet's current Polymarket positions. Use after placing a trade to confirm it landed, or when the user asks 'what do I hold'. Pass the wallet address from wallet_status.",
  inputSchema: z.object({
    address: z.string().describe("The wallet address to query."),
  }),
  execute: async ({ address }) => {
    const positions = await getPositions(address);
    return { positions };
  },
});

export const suggestRepliesTool = tool({
  description:
    "Offer the user 2-4 short pre-written replies they can click instead of typing. Use whenever you've asked them a question, asked for confirmation, or there's a small natural set of next moves (e.g. 'Place it', 'Refine to $500', 'What's the worst case?'). Keep each reply ≤8 words, written in the user's voice (first person where natural). They can still type a free response.",
  inputSchema: z.object({
    replies: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(4)
      .describe("2-4 short suggested replies."),
  }),
  execute: ({ replies }) => ({ replies }),
});

export const brokerTools = {
  search_markets: searchMarketsTool,
  search_weather_markets: searchWeatherMarketsTool,
  list_cities: listCitiesTool,
  get_market: getMarketTool,
  compute_hedge_quote: computeHedgeQuoteTool,
  estimate_correlation: estimateCorrelationTool,
  assess_basis_risk: assessBasisRiskTool,
  compose_basket: composeBasketTool,
  what_if: whatIfTool,
  wallet_status: walletStatusTool,
  setup_wallet: setupWalletTool,
  run_approvals: runApprovalsTool,
  place_order: placeOrderTool,
  get_positions: getPositionsTool,
  suggest_replies: suggestRepliesTool,
};
