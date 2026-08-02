/**
 * Kalshi venue adapter.
 *
 * Kalshi is a CFTC-designated contract market, and its Climate and Weather
 * category carries per-city daily temperature ladders, rainfall, snowfall and
 * hurricane series. Market data is public, so discovery and pricing need no
 * credentials; only order placement does.
 *
 * Contracts are read over plain HTTP rather than through a local CLI binary so
 * this module runs anywhere the rest of the product runs — serverless handlers,
 * an MCP server, or a scheduled roll.
 */
import { z } from "zod";
import type {
  Ladder,
  Market,
  Peril,
  Settlement,
  SettlementSource,
  Strike,
  WeatherSeries,
} from "./types.js";
import {
  isIntegralUnit,
  locationFromTitle,
  normalizeStrikeType,
  perilFromText,
  stationFromRules,
  unitFromLabel,
} from "./weather.js";

const BASE_URL =
  process.env["KALSHI_API_URL"] ?? "https://api.elections.kalshi.com/trade-api/v2";

const WEATHER_CATEGORY = "Climate and Weather";

const REQUEST_TIMEOUT_MS = 20_000;

const RawSettlementSource = z
  .object({ name: z.string().nullish(), url: z.string().nullish() })
  .loose();

const RawSeries = z
  .object({
    ticker: z.string(),
    title: z.string(),
    category: z.string().nullish(),
    frequency: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    settlement_sources: z.array(RawSettlementSource).nullish(),
  })
  .loose();

const RawMarket = z
  .object({
    ticker: z.string(),
    event_ticker: z.string(),
    title: z.string().nullish(),
    subtitle: z.string().nullish(),
    yes_sub_title: z.string().nullish(),
    status: z.string().nullish(),
    strike_type: z.string().nullish(),
    floor_strike: z.number().nullish(),
    cap_strike: z.number().nullish(),
    open_time: z.string().nullish(),
    close_time: z.string().nullish(),
    expiration_time: z.string().nullish(),
    occurrence_datetime: z.string().nullish(),
    rules_primary: z.string().nullish(),
    yes_bid_dollars: z.string().nullish(),
    yes_ask_dollars: z.string().nullish(),
    no_bid_dollars: z.string().nullish(),
    no_ask_dollars: z.string().nullish(),
    liquidity_dollars: z.string().nullish(),
    volume_fp: z.string().nullish(),
    volume_24h_fp: z.string().nullish(),
    open_interest_fp: z.string().nullish(),
  })
  .loose();

const RawEvent = z
  .object({
    event_ticker: z.string(),
    series_ticker: z.string().nullish(),
    title: z.string().nullish(),
    category: z.string().nullish(),
    markets: z.array(RawMarket).nullish(),
  })
  .loose();

type RawSeriesT = z.infer<typeof RawSeries>;
type RawMarketT = z.infer<typeof RawMarket>;

async function kalshiGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Kalshi GET ${url.pathname}${url.search} failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  return (await response.json()) as unknown;
}

function toNumber(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return 0;
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert Kalshi's strike bounds into inclusive bounds.
 *
 * Kalshi's `less` and `greater` strikes are *exclusive* (`cap_strike: 80` reads
 * "less than 80", labelled "79° or below") while `between` is inclusive. Cover
 * has to be shaped against a loss curve, so every bound is normalized to the
 * inclusive reading its own label already uses. The ±1 step only applies to
 * integer-valued underlyings; a continuous one (rainfall in inches) keeps the
 * exclusive bound, since there is no meaningful next value down.
 */
export function normalizeStrike(raw: RawMarketT): Strike | null {
  const type = normalizeStrikeType(raw.strike_type);
  const label = raw.yes_sub_title ?? raw.subtitle ?? "";
  if (type === "unknown" && raw.floor_strike == null && raw.cap_strike == null) return null;
  const unit = unitFromLabel(label);
  const step = isIntegralUnit(unit) ? 1 : 0;
  let floor: number | null = raw.floor_strike ?? null;
  let cap: number | null = raw.cap_strike ?? null;
  if (type === "less") {
    floor = null;
    cap = cap === null ? null : cap - step;
  } else if (type === "greater") {
    cap = null;
    floor = floor === null ? null : floor + step;
  }
  return { type, floor, cap, unit, label };
}

function settlementFrom(raw: RawMarketT, sources: SettlementSource[]): Settlement {
  return {
    sources,
    station: stationFromRules(raw.rules_primary),
    rules: raw.rules_primary ?? null,
  };
}

function sourcesFrom(series: RawSeriesT | null): SettlementSource[] {
  return (series?.settlement_sources ?? [])
    .map((s) => ({ name: s.name ?? "", url: s.url ?? null }))
    .filter((s) => s.name !== "");
}

export interface SeriesContext {
  seriesTicker: string;
  peril: Peril | null;
  location: string | null;
  sources: SettlementSource[];
}

/** Map a raw Kalshi market onto the venue-neutral `Market` shape. */
export function normalizeMarket(raw: RawMarketT, context: SeriesContext): Market {
  const yesAsk = toNumber(raw.yes_ask_dollars);
  const noAsk = toNumber(raw.no_ask_dollars);
  const tradeable =
    raw.status === "active" && ((yesAsk > 0 && yesAsk < 1) || (noAsk > 0 && noAsk < 1));
  return {
    venue: "kalshi",
    id: raw.ticker,
    slug: raw.ticker,
    question: raw.title ?? raw.ticker,
    description: raw.yes_sub_title ?? raw.subtitle ?? null,
    startDate: raw.open_time ?? null,
    endDate: raw.close_time ?? raw.expiration_time ?? null,
    liquidity: toNumber(raw.liquidity_dollars),
    volume: toNumber(raw.volume_fp),
    volume24h: toNumber(raw.volume_24h_fp),
    openInterest: toNumber(raw.open_interest_fp),
    active: raw.status === "active",
    closed: raw.status === "settled" || raw.status === "closed",
    acceptingOrders: tradeable,
    orderMinSize: 0,
    outcomes: ["Yes", "No"],
    outcomePrices: [yesAsk, noAsk],
    quotes: {
      yesBid: toNumber(raw.yes_bid_dollars),
      yesAsk,
      noBid: toNumber(raw.no_bid_dollars),
      noAsk,
    },
    peril: context.peril,
    location: context.location,
    strike: normalizeStrike(raw),
    settlement: settlementFrom(raw, context.sources),
    execution: {
      venue: "kalshi",
      ticker: raw.ticker,
      eventTicker: raw.event_ticker,
      seriesTicker: context.seriesTicker,
    },
    url: `https://kalshi.com/markets/${context.seriesTicker.toLowerCase()}`,
  };
}

/**
 * Classify a series, trusting the title over the ticker and tags.
 *
 * Kalshi tags are broad buckets: "Rain Chicago" is tagged "Snow and rain",
 * which reads as snow if title and tags are matched as one blob. The title
 * names the actual underlying, so it decides; ticker and tags only break a tie
 * the title leaves open.
 */
function perilForSeries(raw: RawSeriesT, tags: readonly string[]): Peril {
  const fromTitle = perilFromText(raw.title);
  if (fromTitle !== "other") return fromTitle;
  return perilFromText(`${raw.ticker} ${tags.join(" ")}`);
}

export function normalizeSeries(raw: RawSeriesT): WeatherSeries {
  const tags = raw.tags ?? [];
  return {
    venue: "kalshi",
    ticker: raw.ticker,
    title: raw.title,
    peril: perilForSeries(raw, tags),
    location: locationFromTitle(raw.title),
    frequency: raw.frequency ?? "custom",
    settlementSources: sourcesFrom(raw),
    tags,
  };
}

function strikeRank(m: Market): number {
  return m.strike?.floor ?? m.strike?.cap ?? Number.POSITIVE_INFINITY;
}

/** Sort rungs from the lowest bucket upward so a ladder reads in order. */
function byStrikeAscending(a: Market, b: Market): number {
  return strikeRank(a) - strikeRank(b);
}

const seriesCache = new Map<string, { at: number; value: WeatherSeries[] }>();
const SERIES_TTL_MS = 10 * 60_000;

/**
 * Every Climate and Weather series Kalshi lists. Cached for ten minutes: the
 * catalogue turns over on the order of weeks, while ladders inside it move by
 * the second and are never cached.
 */
export async function listWeatherSeries(): Promise<WeatherSeries[]> {
  const cached = seriesCache.get(WEATHER_CATEGORY);
  if (cached && Date.now() - cached.at < SERIES_TTL_MS) return cached.value;
  const data = await kalshiGet("/series", { category: WEATHER_CATEGORY });
  const parsed = z.object({ series: z.array(RawSeries).nullish() }).parse(data);
  const value = (parsed.series ?? []).map(normalizeSeries);
  seriesCache.set(WEATHER_CATEGORY, { at: Date.now(), value });
  return value;
}

export async function getSeries(ticker: string): Promise<WeatherSeries> {
  const data = await kalshiGet(`/series/${encodeURIComponent(ticker)}`);
  const parsed = z.object({ series: RawSeries }).parse(data);
  return normalizeSeries(parsed.series);
}

async function contextFor(seriesTicker: string): Promise<SeriesContext> {
  const series = await getSeries(seriesTicker);
  return {
    seriesTicker,
    peril: series.peril,
    location: series.location,
    sources: series.settlementSources,
  };
}

/**
 * The open strike ladder for one event — every bucket of the same underlying on
 * the same date, priced and sorted.
 */
export async function getLadder(eventTicker: string): Promise<Ladder> {
  const data = await kalshiGet(`/events/${encodeURIComponent(eventTicker)}`, {
    with_nested_markets: "true",
  });
  const parsed = z.object({ event: RawEvent }).parse(data);
  const event = parsed.event;
  const rawMarkets = event.markets ?? [];
  const seriesTicker = event.series_ticker ?? eventTicker.split("-")[0] ?? eventTicker;
  const context = await contextFor(seriesTicker);
  const rungs = rawMarkets.map((m) => normalizeMarket(m, context)).toSorted(byStrikeAscending);
  const first = rawMarkets[0];
  return {
    venue: "kalshi",
    seriesTicker,
    eventTicker: event.event_ticker,
    title: event.title ?? first?.title ?? eventTicker,
    peril: context.peril,
    location: context.location,
    occurrenceDate: first?.occurrence_datetime ?? null,
    closeTime: first?.close_time ?? null,
    settlement: first
      ? settlementFrom(first, context.sources)
      : { sources: context.sources, station: null, rules: null },
    rungs,
  };
}

export async function getMarket(ticker: string): Promise<Market> {
  const data = await kalshiGet(`/markets/${encodeURIComponent(ticker)}`);
  const parsed = z.object({ market: RawMarket }).parse(data);
  const seriesTicker = parsed.market.event_ticker.split("-")[0] ?? parsed.market.event_ticker;
  return normalizeMarket(parsed.market, await contextFor(seriesTicker));
}

export interface FindCoverArgs {
  /** Free-text place, matched against series locations. */
  location?: string;
  peril?: Peril;
  limit?: number;
}

/**
 * Find the weather series that could cover a loss at a location. Returns series
 * rather than individual contracts: picking a strike is a sizing decision that
 * belongs to the loss curve, not to search.
 */
export async function findSeries(args: FindCoverArgs = {}): Promise<WeatherSeries[]> {
  const all = await listWeatherSeries();
  const place = args.location?.trim().toLowerCase();
  const matched = all.filter((s) => {
    if (args.peril && s.peril !== args.peril) return false;
    if (!place) return true;
    return `${s.location ?? ""} ${s.title}`.toLowerCase().includes(place);
  });
  return matched.slice(0, args.limit ?? 20);
}

/** Every open contract in a series, priced and sorted by strike. */
export async function getSeriesMarkets(seriesTicker: string, limit = 60): Promise<Market[]> {
  const data = await kalshiGet("/markets", {
    series_ticker: seriesTicker,
    status: "open",
    limit: String(limit),
  });
  const parsed = z.object({ markets: z.array(RawMarket).nullish() }).parse(data);
  const context = await contextFor(seriesTicker);
  return (parsed.markets ?? [])
    .map((m) => normalizeMarket(m, context))
    .toSorted(byStrikeAscending);
}

/** Open events for a series, most recent first, as `{eventTicker, title}` pairs. */
export async function listEvents(
  seriesTicker: string,
  limit = 10,
): Promise<Array<{ eventTicker: string; title: string }>> {
  const data = await kalshiGet("/events", {
    series_ticker: seriesTicker,
    status: "open",
    limit: String(limit),
  });
  const parsed = z.object({ events: z.array(RawEvent).nullish() }).parse(data);
  return (parsed.events ?? []).map((e) => ({
    eventTicker: e.event_ticker,
    title: e.title ?? e.event_ticker,
  }));
}
