/**
 * Venue registry.
 *
 * Where a contract trades is a routing decision, not a fact the rest of the
 * product should know about. Discovery, pricing and basis scoring all work off
 * the venue-neutral `Market`, so adding or dropping a venue stays a change in
 * one file.
 *
 * Kalshi is the default: it is a CFTC-designated contract market, it lists
 * per-city daily temperature ladders with named NWS settlement stations, and
 * its market data is public. Polymarket remains available for perils Kalshi
 * doesn't list.
 */
import * as kalshi from "./kalshi.js";
import * as polymarket from "./polymarket.js";
import type { Market, Peril, VenueId, WeatherSeries } from "./types.js";

export interface CoverQuery {
  /** Free-text place, matched against the venue's own location naming. */
  location?: string;
  peril?: Peril;
  limit?: number;
}

export interface Venue {
  readonly id: VenueId;
  /** Tradeable weather contracts matching the query, best depth first. */
  findWeatherMarkets(query: CoverQuery): Promise<Market[]>;
  getMarket(id: string): Promise<Market>;
}

const DEFAULT_LIMIT = 8;

/**
 * Series to expand into contracts per query.
 *
 * Kalshi's catalogue carries dormant and superseded series alongside live ones
 * — Chicago alone lists eleven, of which seven have nothing open — and a
 * catalogue-order slice reliably lands on the dead ones. Fanning out wider and
 * dropping the empties costs a handful of parallel requests and is the
 * difference between finding cover and reporting none.
 */
const SERIES_FANOUT = 6;

/**
 * Cadence a business can actually hedge on, best first. Daily contracts roll
 * with the exposure; one-off and annual series are usually last season's.
 */
const FREQUENCY_RANK: Record<string, number> = {
  daily: 4,
  hourly: 3,
  weekly: 2,
  monthly: 1,
};

/**
 * Rank candidate series before spending a request on each. Kalshi supersedes
 * series in place and keeps the old ticker listed, with the current generation
 * carrying a `KX` prefix, so that prefix breaks ties between two series holding
 * the same title.
 */
function rankSeries(a: WeatherSeries, b: WeatherSeries): number {
  const score = (s: WeatherSeries): number =>
    (FREQUENCY_RANK[s.frequency] ?? 0) * 2 + (s.ticker.startsWith("KX") ? 1 : 0);
  return score(b) - score(a);
}

function depthOf(m: Market): number {
  return m.openInterest || m.volume24h || m.liquidity;
}

function byDepthDescending(a: Market, b: Market): number {
  return depthOf(b) - depthOf(a);
}

const kalshiVenue: Venue = {
  id: "kalshi",
  async findWeatherMarkets(query) {
    const series = await kalshi.findSeries({
      ...(query.location !== undefined && { location: query.location }),
      ...(query.peril !== undefined && { peril: query.peril }),
      limit: 40,
    });
    const candidates = series.toSorted(rankSeries).slice(0, SERIES_FANOUT);
    const batches = await Promise.all(
      candidates.map((s) => kalshi.getSeriesMarkets(s.ticker).catch(() => [])),
    );
    return batches
      .flat()
      .filter((m) => m.acceptingOrders)
      .toSorted(byDepthDescending)
      .slice(0, query.limit ?? DEFAULT_LIMIT);
  },
  getMarket: kalshi.getMarket,
};

const polymarketVenue: Venue = {
  id: "polymarket",
  async findWeatherMarkets(query) {
    const keyword = [query.location, query.peril?.replace("_", " ")]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    const markets = await polymarket.searchMarkets(keyword || "weather", 30);
    return markets
      .filter((m) => !m.closed && m.peril !== "other")
      .filter((m) => (query.peril ? m.peril === query.peril : true))
      .toSorted(byDepthDescending)
      .slice(0, query.limit ?? DEFAULT_LIMIT);
  },
  getMarket: polymarket.getMarket,
};

const VENUES: Record<VenueId, Venue> = {
  kalshi: kalshiVenue,
  polymarket: polymarketVenue,
};

export const DEFAULT_VENUE: VenueId = "kalshi";

export function getVenue(id: VenueId = DEFAULT_VENUE): Venue {
  const venue = VENUES[id];
  if (!venue) {
    throw new Error(`unknown venue "${id}" (expected one of: ${Object.keys(VENUES).join(", ")})`);
  }
  return venue;
}

export function listVenues(): VenueId[] {
  return Object.keys(VENUES) as VenueId[];
}

/** Weather series available for a location, on the default venue. */
export function findCover(query: CoverQuery = {}): Promise<WeatherSeries[]> {
  return kalshi.findSeries(query);
}
