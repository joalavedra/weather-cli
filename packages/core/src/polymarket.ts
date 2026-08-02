import { execa } from "execa";
import { z } from "zod";
import type { Market } from "./types.js";
import { locationFromTitle, perilFromText } from "./weather.js";

const RawMarket = z
  .object({
    id: z.string(),
    slug: z.string(),
    question: z.string(),
    description: z.string().nullish(),
    endDate: z.string().nullish(),
    startDate: z.string().nullish(),
    liquidity: z.string().nullish(),
    volume: z.string().nullish(),
    active: z.boolean().nullish(),
    closed: z.boolean().nullish(),
    outcomes: z.string().nullish(),
    outcomePrices: z.string().nullish(),
    conditionId: z.string().nullish(),
    clobTokenIds: z.string().nullish(),
    acceptingOrders: z.boolean().nullish(),
    orderMinSize: z.string().nullish(),
    negRisk: z.boolean().nullish(),
    image: z.string().nullish(),
  })
  .loose();

type RawMarketT = z.infer<typeof RawMarket>;

const POLYMARKET_BIN = process.env["POLYMARKET_BIN"] ?? "polymarket";

function parseJsonArray(input: string | null | undefined): unknown[] {
  if (!input) return [];
  try {
    const parsed: unknown = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(input: string | null | undefined): number {
  if (!input) return 0;
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map a raw Polymarket market onto the venue-neutral shape.
 *
 * Polymarket publishes no strike bounds or settlement source, so `strike` is
 * null and `settlement` is empty rather than fabricated — an unknown
 * observation point has to read as unknown, since basis-risk scoring depends on
 * it. Its `outcomePrices` are last-trade prices rather than a live ask, so the
 * bid/ask fields mirror them instead of implying a book the CLI doesn't return.
 */
function transform(raw: RawMarketT): Market {
  const outcomes = parseJsonArray(raw.outcomes).filter(
    (x): x is string => typeof x === "string",
  );
  const prices = parseJsonArray(raw.outcomePrices)
    .filter((x): x is string => typeof x === "string")
    .map(toNumber);
  const [yes = 0, no = 0] = prices;
  return {
    venue: "polymarket",
    id: raw.id,
    slug: raw.slug,
    question: raw.question,
    description: raw.description ?? null,
    endDate: raw.endDate ?? null,
    startDate: raw.startDate ?? null,
    liquidity: toNumber(raw.liquidity),
    volume: toNumber(raw.volume),
    volume24h: 0,
    openInterest: 0,
    active: raw.active ?? false,
    closed: raw.closed ?? false,
    outcomes,
    outcomePrices: prices,
    quotes: { yesBid: yes, yesAsk: yes, noBid: no, noAsk: no },
    peril: perilFromText(raw.question),
    location: locationFromTitle(raw.question),
    strike: null,
    settlement: { sources: [], station: null, rules: raw.description ?? null },
    acceptingOrders: raw.acceptingOrders ?? false,
    orderMinSize: toNumber(raw.orderMinSize),
    execution: {
      venue: "polymarket",
      clobTokenIds: parseJsonArray(raw.clobTokenIds).filter(
        (x): x is string => typeof x === "string",
      ),
      conditionId: raw.conditionId ?? null,
      negRisk: raw.negRisk ?? false,
    },
    url: `https://polymarket.com/event/${raw.slug}`,
  };
}

async function runPolymarket(args: string[]): Promise<unknown> {
  const result = await execa(POLYMARKET_BIN, ["-o", "json", ...args], {
    timeout: 30_000,
    reject: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `polymarket ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout) as unknown;
}

export async function searchMarkets(
  keyword: string,
  limit = 20,
): Promise<Market[]> {
  const data = await runPolymarket([
    "markets",
    "search",
    keyword,
    "--limit",
    String(limit),
  ]);
  return RawMarket.array().parse(data).map(transform);
}

export async function getMarket(idOrSlug: string): Promise<Market> {
  const data = await runPolymarket(["markets", "get", idOrSlug]);
  return transform(RawMarket.parse(data));
}

