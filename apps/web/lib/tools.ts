import { tool } from "ai";
import { z } from "zod";
import {
  computeHedge,
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
import type { Market } from "@weather/core";

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
  what_if: whatIfTool,
  wallet_status: walletStatusTool,
  setup_wallet: setupWalletTool,
  run_approvals: runApprovalsTool,
  place_order: placeOrderTool,
  get_positions: getPositionsTool,
  suggest_replies: suggestRepliesTool,
};
