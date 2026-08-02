import { tool } from "ai";
import { z } from "zod";
import {
  composeBasket,
  computeBasisRisk,
  computeHedge,
  estimateTriggerCorrelation,
  createWallet,
  getPositions,
  getVenue,
  getWalletStatus,
  kalshi,
  placeMarketOrder,
  quoteFromMarket,
  runApprovals,
} from "@weather/core";
import type { BasketLeg, Market, Peril } from "@weather/core";

const MAX_RESULTS = 8;

const PERILS = [
  "high_temp",
  "low_temp",
  "rain",
  "snow",
  "hurricane",
  "tornado",
  "wind",
] as const satisfies readonly Peril[];

const perilSchema = z.enum(PERILS);

/** Resolve a contract id through the default venue. */
async function fetchMarket(id: string): Promise<Market> {
  return getVenue().getMarket(id);
}

function summarizeMarket(m: Market) {
  return {
    id: m.id,
    venue: m.venue,
    question: m.question,
    peril: m.peril,
    location: m.location,
    bucket: m.strike?.label ?? null,
    strike: m.strike,
    prices: {
      yesAsk: Number(m.quotes.yesAsk.toFixed(4)),
      noAsk: Number(m.quotes.noAsk.toFixed(4)),
    },
    openInterest: Math.round(m.openInterest),
    endDate: m.endDate,
    acceptingOrders: m.acceptingOrders,
    settlesAt: m.settlement.station,
    settlementSource: m.settlement.sources[0]?.name ?? null,
    url: m.url,
  };
}

export const findCoverTool = tool({
  description:
    "Find the weather contract series that could cover a loss at a location. Returns series (a family of contracts sharing a peril, place and settlement station), not individual contracts — picking a strike is a sizing decision that comes later. Always start here once you know WHERE the client's loss happens and WHAT physically drives it. The `settlementSource` is the observation the contract resolves on; the distance between that station and the client's premises is the geographic half of basis risk, so always surface it.",
  inputSchema: z.object({
    location: z
      .string()
      .optional()
      .describe("Where the loss happens, e.g. 'Chicago', 'Los Angeles', 'Miami'."),
    peril: perilSchema
      .optional()
      .describe("The physical driver of the loss. Omit to see everything at that location."),
  }),
  execute: async ({ location, peril }) => {
    const series = await kalshi.findSeries({
      ...(location !== undefined && { location }),
      ...(peril !== undefined && { peril }),
      limit: 12,
    });
    return {
      series: series.map((s) => ({
        ticker: s.ticker,
        title: s.title,
        peril: s.peril,
        location: s.location,
        frequency: s.frequency,
        settlementSource: s.settlementSources[0]?.name ?? null,
      })),
    };
  },
});

export const listEventsTool = tool({
  description:
    "List the open events for a series ticker (e.g. KXHIGHCHI). An event is one measurement period — for a daily series, one date. Use this to find the event covering the client's risk window, then call get_ladder on it.",
  inputSchema: z.object({
    seriesTicker: z.string().describe("Series ticker from find_cover, e.g. 'KXHIGHCHI'."),
  }),
  execute: async ({ seriesTicker }) => ({
    events: await kalshi.listEvents(seriesTicker, 10),
  }),
});

export const getLadderTool = tool({
  description:
    "Fetch one event's full strike ladder — every temperature or rainfall bucket for the same place and date, priced. This is the core primitive for parametric cover: a single binary is a bet, but a ladder can be shaped to match a loss curve. Use it to pick the bucket(s) the client's loss actually lives in. Returns the settlement station and source alongside the rungs.",
  inputSchema: z.object({
    eventTicker: z
      .string()
      .describe("Event ticker from list_events, e.g. 'KXHIGHCHI-26AUG02'."),
  }),
  execute: async ({ eventTicker }) => {
    const ladder = await kalshi.getLadder(eventTicker);
    return {
      ladder: {
        eventTicker: ladder.eventTicker,
        title: ladder.title,
        peril: ladder.peril,
        location: ladder.location,
        settlesAt: ladder.settlement.station,
        settlementSources: ladder.settlement.sources,
        closeTime: ladder.closeTime,
        rungs: ladder.rungs.map(summarizeMarket),
      },
    };
  },
});

export const findContractsTool = tool({
  description:
    "Find tradeable weather contracts for a location directly, deepest book first, skipping the series and ladder walk. Use when the client's need is broad ('what can I hedge in Chicago?') rather than tied to a specific date. For shaping cover against a loss curve, prefer find_cover then get_ladder.",
  inputSchema: z.object({
    location: z.string().optional().describe("Where the loss happens."),
    peril: perilSchema.optional().describe("Restrict to one physical driver."),
  }),
  execute: async ({ location, peril }) => {
    const markets = await getVenue().findWeatherMarkets({
      ...(location !== undefined && { location }),
      ...(peril !== undefined && { peril }),
      limit: MAX_RESULTS,
    });
    return { markets: markets.map(summarizeMarket) };
  },
});

export const getMarketTool = tool({
  description:
    "Fetch full details for a single contract by id, including its strike bucket, live ask, and the verbatim resolution rule naming the observation station. Use this before recommending a specific position.",
  inputSchema: z.object({
    id: z.string().describe("The contract id, e.g. 'KXHIGHCHI-26AUG02-B73.5'."),
  }),
  execute: async ({ id }) => {
    const market = await fetchMarket(id);
    return {
      market: { ...summarizeMarket(market), rules: market.settlement.rules },
    };
  },
});

export const computeHedgeQuoteTool = tool({
  description:
    "Price cover on one contract: how many contracts the premium buys, the max payout, the net if it triggers, and the coverage ratio against the client's stated exposure. Always run this before recommending a position. Frame the result as insurance — the budget is a premium, and losing it when nothing goes wrong is the expected cost of cover, not a failed trade.",
  inputSchema: z.object({
    id: z.string().describe("The contract id to quote against."),
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
  execute: async ({ id, side, budgetUsdc, exposureValueUsdc }) => {
    const market = await fetchMarket(id);
    const quote = quoteFromMarket(market, side, budgetUsdc, exposureValueUsdc);
    return {
      market: summarizeMarket(market),
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
    id: z.string().describe("The contract id to assess."),
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
    id,
    side,
    budgetUsdc,
    exposureValueUsdc,
    lossEvent,
    windowStart,
    windowEnd,
    triggerCorrelation,
    correlationRationale,
  }) => {
    const market = await fetchMarket(id);
    const quote = quoteFromMarket(market, side, budgetUsdc, exposureValueUsdc);
    const basis = computeBasisRisk({
      quote,
      loss: { lossEvent, exposureValueUsdc, windowStart, windowEnd },
      marketEndDate: market.endDate,
      triggerCorrelation,
      correlationRationale,
    });
    return {
      market: summarizeMarket(market),
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
          id: z.string().describe("Contract id for this leg."),
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
        const market = await fetchMarket(l.id);
        const idx = market.outcomes.findIndex(
          (o) => o.toLowerCase() === l.side.toLowerCase(),
        );
        const price = market.outcomePrices[idx];
        if (price === undefined) {
          throw new Error(
            `contract ${l.id} has no '${l.side}' side priced`,
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
    "Buy cover on a Polymarket contract using the configured wallet. Only call after the user has explicitly confirmed in chat — never place orders speculatively. Execution is Polymarket-only today: Kalshi contracts are discoverable and priceable but not yet bindable, and this tool will refuse them rather than route an order to the wrong venue. Returns the order ID and fill status.",
  inputSchema: z.object({
    id: z.string().describe("The contract id to buy."),
    amountUsdc: z.number().positive().describe("USDC premium to spend."),
    side: z.enum(["Yes", "No"]).describe("Which side is being bought."),
  }),
  execute: async ({ id, amountUsdc, side }) => {
    const market = await fetchMarket(id);
    if (market.execution.venue !== "polymarket") {
      throw new Error(
        `Cannot place this order: ${id} trades on ${market.venue}, and only Polymarket execution is wired up. ` +
          `Kalshi order placement needs an API key with RSA request signing. Quote and basis-score it here, then place it on Kalshi directly.`,
      );
    }
    const tokenId = market.execution.clobTokenIds[side === "Yes" ? 0 : 1];
    if (tokenId === undefined) {
      throw new Error(`contract ${id} has no ${side} token to buy`);
    }
    const result = await placeMarketOrder({ tokenId, side: "buy", amountUsdc });
    return {
      orderId: result.orderId,
      status: result.status,
      filled: result.filled,
      marketQuestion: market.question,
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
  find_cover: findCoverTool,
  list_events: listEventsTool,
  get_ladder: getLadderTool,
  find_contracts: findContractsTool,
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
