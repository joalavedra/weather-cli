/**
 * Polymarket venue adapter.
 *
 * This is the international half of the product. Kalshi lists US weather only,
 * while Polymarket runs daily high and low temperature ladders for cities
 * across Europe, Asia, the Middle East, Africa, Oceania and South America — in
 * 1°C buckets, each naming the airport station it settles on.
 *
 * Read over Polymarket's public Gamma API rather than by shelling out to the
 * `polymarket` CLI. The binary approach could not run in a serverless handler
 * at all, which meant the deployed product had no international cover of any
 * kind.
 */
import { z } from "zod";
import type { Ladder, Market, Peril, Settlement, Strike } from "./types.js";
import { perilFromText, unitFromLabel } from "./weather.js";

const GAMMA_URL = process.env["POLYMARKET_API_URL"] ?? "https://gamma-api.polymarket.com";

const REQUEST_TIMEOUT_MS = 20_000;

/** The tag Polymarket files every city temperature ladder under. */
const DAILY_TEMPERATURE_TAG = "daily-temperature";

const RawMarket = z
  .object({
    id: z.string(),
    slug: z.string().nullish(),
    question: z.string(),
    description: z.string().nullish(),
    endDate: z.string().nullish(),
    startDate: z.string().nullish(),
    liquidity: z.union([z.string(), z.number()]).nullish(),
    volume: z.union([z.string(), z.number()]).nullish(),
    bestAsk: z.number().nullish(),
    bestBid: z.number().nullish(),
    outcomes: z.union([z.string(), z.array(z.string())]).nullish(),
    outcomePrices: z.union([z.string(), z.array(z.string())]).nullish(),
    active: z.boolean().nullish(),
    closed: z.boolean().nullish(),
    acceptingOrders: z.boolean().nullish(),
    orderMinSize: z.union([z.string(), z.number()]).nullish(),
  })
  .loose();

const RawEvent = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    seriesSlug: z.string().nullish(),
    endDate: z.string().nullish(),
    closed: z.boolean().nullish(),
    markets: z.array(RawMarket).nullish(),
    tags: z.array(z.object({ slug: z.string().nullish() }).loose()).nullish(),
  })
  .loose();

type RawMarketT = z.infer<typeof RawMarket>;
type RawEventT = z.infer<typeof RawEvent>;

async function gammaGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${GAMMA_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Polymarket GET ${url.pathname}${url.search} failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }
  return (await response.json()) as unknown;
}

function toNumber(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return 0;
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : 0;
}

function toStringArray(input: string | string[] | null | undefined): string[] {
  if (Array.isArray(input)) return input;
  if (typeof input !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Read the strike out of a market's question.
 *
 * Polymarket states the bucket in prose rather than in fields — "be 25°C or
 * below", "be 26°C", "be 35°C or higher" — so the title is the only place the
 * bounds exist. An unparsed title means a rung that can never be selected into
 * a structure, which is exactly why this venue previously contributed nothing.
 */
export function parseStrike(question: string): Strike | null {
  /*
   * Anchored on whitespace rather than a word boundary: `\b` cannot match
   * between a space and a minus sign, so "-5°C" parsed as +5 and put a Moscow
   * winter rung on the wrong side of the ladder entirely.
   */
  const match =
    /(?:^|[\s(])(-?\d+(?:\.\d+)?)\s*°\s*([CF])\b\s*(or below|or lower|or higher|or above)?/i.exec(
      question,
    );
  if (!match) return null;
  const value = Number(match[1]);
  const scale = (match[2] ?? "C").toUpperCase();
  const qualifier = match[3]?.toLowerCase();
  const label = `${value}°${scale}${qualifier ? ` ${qualifier}` : ""}`;
  const unit = unitFromLabel(label);

  if (qualifier === "or below" || qualifier === "or lower") {
    return { type: "less", floor: null, cap: value, unit, label };
  }
  if (qualifier === "or higher" || qualifier === "or above") {
    return { type: "greater", floor: value, cap: null, unit, label };
  }
  // A bare degree is a single-degree bucket, not an open-ended threshold.
  return { type: "between", floor: value, cap: value, unit, label };
}

/**
 * Pull the settlement station out of a market's resolution text, e.g.
 * "the highest temperature recorded at the London City Airport Station".
 */
export function parseStation(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = /\brecorded at (?:the )?(.+?)(?: in degrees| in °|,|\.|\n)/i.exec(description);
  const station = match?.[1]?.trim();
  return station === undefined || station === "" ? null : station;
}

function parseSource(description: string | null | undefined): Settlement["sources"] {
  if (!description) return [];
  const name = /resolution source for this market will be information from ([^,.]+)/i.exec(
    description,
  )?.[1];
  const url = /(https?:\/\/\S+?)(?=[\s)]|$)/.exec(description)?.[1];
  if (!name) return [];
  return [{ name: name.trim(), url: url ?? null }];
}

function settlementFrom(raw: RawMarketT): Settlement {
  return {
    sources: parseSource(raw.description),
    station: parseStation(raw.description),
    rules: raw.description ?? null,
  };
}

/** The city a ladder settles on, from the event's series slug or its title. */
export function locationFromEvent(event: RawEventT): string | null {
  const fromSeries = event.seriesSlug?.replace(/-daily-(weather|lowest-temperature)$/, "");
  const slug = fromSeries ?? null;
  if (slug && slug !== "") {
    return slug
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return /\bin ([A-Z][\w' ]+?) on\b/.exec(event.title)?.[1]?.trim() ?? null;
}

export interface EventContext {
  peril: Peril | null;
  location: string | null;
}

export function normalizeMarket(raw: RawMarketT, context: EventContext): Market {
  const prices = toStringArray(raw.outcomePrices).map(toNumber);
  const yesAsk = raw.bestAsk ?? prices[0] ?? 0;
  const noAsk = yesAsk > 0 && yesAsk < 1 ? 1 - (raw.bestBid ?? yesAsk) : (prices[1] ?? 0);
  const outcomes = toStringArray(raw.outcomes);
  return {
    venue: "polymarket",
    id: raw.id,
    slug: raw.slug ?? raw.id,
    question: raw.question,
    description: raw.description ?? null,
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    liquidity: toNumber(raw.liquidity),
    volume: toNumber(raw.volume),
    volume24h: 0,
    openInterest: 0,
    active: raw.active ?? true,
    closed: raw.closed ?? false,
    acceptingOrders: (raw.acceptingOrders ?? true) && yesAsk > 0 && yesAsk < 1,
    orderMinSize: toNumber(raw.orderMinSize),
    outcomes: outcomes.length > 0 ? outcomes : ["Yes", "No"],
    outcomePrices: [yesAsk, noAsk],
    quotes: { yesBid: raw.bestBid ?? 0, yesAsk, noBid: 1 - yesAsk, noAsk },
    peril: context.peril,
    location: context.location,
    strike: parseStrike(raw.question),
    settlement: settlementFrom(raw),
    url: `https://polymarket.com/event/${raw.slug ?? ""}`,
  };
}

function strikeRank(m: Market): number {
  return m.strike?.floor ?? m.strike?.cap ?? Number.POSITIVE_INFINITY;
}

function rungOrder(a: Market, b: Market): number {
  return strikeRank(a) - strikeRank(b);
}

export function normalizeLadder(event: RawEventT): Ladder {
  const location = locationFromEvent(event);
  const peril = perilFromText(event.title);
  const context: EventContext = { peril, location };
  const rungs = (event.markets ?? []).map((m) => normalizeMarket(m, context)).toSorted(rungOrder);
  const first = rungs[0];
  return {
    venue: "polymarket",
    seriesTicker: event.seriesSlug ?? event.slug,
    eventTicker: event.slug,
    title: event.title,
    peril,
    location,
    occurrenceDate: event.endDate ?? null,
    closeTime: event.endDate ?? null,
    settlement: first?.settlement ?? { sources: [], station: null, rules: null },
    rungs,
  };
}

/** Every open daily-temperature ladder Polymarket lists, worldwide. */
export async function listTemperatureLadders(limit = 200): Promise<Ladder[]> {
  const data = await gammaGet("/events", {
    closed: "false",
    limit: String(limit),
    tag_slug: DAILY_TEMPERATURE_TAG,
  });
  return z
    .array(RawEvent)
    .parse(data)
    .map((event) => normalizeLadder(event))
    .filter((ladder) => ladder.rungs.length > 1 && ladder.location !== null);
}

export async function getLadder(eventSlug: string): Promise<Ladder> {
  const data = await gammaGet("/events", { closed: "false", limit: "1", slug: eventSlug });
  const events = z.array(RawEvent).parse(data);
  const event = events[0];
  if (!event) throw new Error(`no open Polymarket event called "${eventSlug}"`);
  return normalizeLadder(event);
}

export async function getMarket(id: string): Promise<Market> {
  const data = await gammaGet("/markets", { id, limit: "1" });
  const markets = z.array(RawMarket).parse(data);
  const raw = markets[0];
  if (!raw) throw new Error(`no Polymarket market called "${id}"`);
  return normalizeMarket(raw, {
    peril: perilFromText(raw.question),
    location: null,
  });
}
