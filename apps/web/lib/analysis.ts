/**
 * Server-side analysis for the workbench.
 *
 * The assistant reaches these calculations through tools. The canvas needs the
 * same answers without a conversation — a broker clicking "solve" should not
 * have to ask a model to do arithmetic. Both paths run the same functions from
 * `@weather/core`; this module is the shared plumbing that turns a stored
 * client into the inputs those functions want.
 */
import {
  alignSamples,
  coverProfile,
  dailyHistory,
  describeFit,
  describeGeoBasis,
  fitLossCurve,
  geocode,
  isMeasurable,
  kalshi,
  measureGeographicBasis,
  solveCover,
} from "@weather/core";
import type {
  CoverPlan,
  DailySeries,
  GeoPoint,
  Ladder,
  LossCurve,
  Peril,
  WeatherSeries,
} from "@weather/core";
import { polymarket } from "@weather/core";
import { loadDataset } from "@/lib/datasets";
import { getJson, putJson } from "@/lib/store";
import type { Client } from "@/lib/clients";

/** How far back to pull observations when measuring basis or replaying cover. */
export const HISTORY_START = "2022-01-01";
export const HISTORY_END = "2025-12-31";

/** Accept either a place name or a raw "lat,lon" pair. */
export async function resolvePoint(place: string): Promise<GeoPoint> {
  const coords = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(place);
  if (coords) {
    return { latitude: Number(coords[1]), longitude: Number(coords[2]), name: place.trim() };
  }
  const point = await geocode(place);
  if (!point) throw new Error(`could not find a place called "${place}"`);
  return point;
}

export interface CurveResult {
  curve: LossCurve;
  summary: string;
  point: GeoPoint;
  /** Observed value and revenue per day, for plotting the fit. */
  scatter: Array<{ value: number; revenue: number }>;
}

/**
 * Fit the client's loss curve from their uploaded revenue.
 *
 * The scatter comes back with the curve because the fit is a claim about their
 * business that they should be able to eyeball. A hockey stick drawn over the
 * actual points is far more convincing — and far more falsifiable — than an R².
 */
export async function fitClientCurve(
  client: Client,
  scale: "F" | "C" = "F",
): Promise<CurveResult> {
  if (!client.datasetId) {
    throw new Error(`${client.name} has no revenue uploaded yet`);
  }
  const dataset = await loadDataset(client.datasetId);
  const point = await resolvePoint(client.premises);
  const [series] = await dailyHistory({
    points: [point],
    start: dataset.start,
    end: dataset.end,
    peril: client.peril,
    scale,
  });
  if (!series) throw new Error("the weather archive returned nothing for that location");

  /*
   * Fit only on the months the business is actually exposed.
   *
   * A patio bar's winter takings say nothing about what a cool July costs it,
   * and including them drags the threshold and slope toward a season the cover
   * will never pay in. It also stretched the fit across the full annual
   * temperature range, where extrapolating the hockey stick implies negative
   * revenue on a January day.
   */
  const inSeason =
    client.months.length > 0
      ? dataset.rows.filter((row) => client.months.includes(Number(row.date.slice(5, 7))))
      : dataset.rows;
  if (inSeason.length === 0) {
    throw new Error(
      `no revenue rows fall in ${client.name}'s exposed months — widen the season or upload a longer history`,
    );
  }

  const samples = alignSamples(inSeason, series);
  const curve = fitLossCurve(samples, series.unit);
  return { curve, summary: describeFit(curve), point, scatter: samples };
}

export interface HistoryPair {
  station: DailySeries;
  premises: DailySeries;
  stationPoint: GeoPoint;
  premisesPoint: GeoPoint;
}

/**
 * Observations at both the settlement station and the client's premises, over
 * the same window and in one request.
 */
/**
 * Locate the station a ladder settles on.
 *
 * Venues name stations for humans, not geocoders — "Chicago Midway, IL"
 * resolves, "London City Airport Station" does not. Progressively simpler forms
 * are tried before falling back to the ladder's own city, because measuring
 * basis against the city is far more useful than refusing to measure it at all.
 */
async function resolveStation(ladder: Ladder): Promise<GeoPoint> {
  const station = ladder.settlement.station;
  const attempts = [
    station,
    station?.replace(/\s+Station$/i, ""),
    station?.replace(/\s+(?:International\s+)?Airport.*$/i, ""),
    ladder.location,
  ].filter((v): v is string => Boolean(v && v.trim() !== ""));
  for (const attempt of attempts) {
    const point = await cachedGeocode(attempt);
    if (point) return point;
  }
  throw new Error(
    `could not locate the settlement point for ${ladder.eventTicker} ("${station ?? "unnamed"}")`,
  );
}

export async function loadHistoryPair(client: Client, ladder: Ladder): Promise<HistoryPair> {
  const [stationPoint, premisesPoint] = await Promise.all([
    resolveStation(ladder),
    resolvePoint(client.premises),
  ]);
  const [station, premises] = await dailyHistory({
    points: [stationPoint, premisesPoint],
    start: HISTORY_START,
    end: HISTORY_END,
    peril: ladder.peril ?? client.peril,
    scale: scaleFor(ladder),
  });
  if (!station || !premises) {
    throw new Error("the weather archive returned nothing for those locations");
  }
  return { station, premises, stationPoint, premisesPoint };
}

export interface CoverResult {
  plan: CoverPlan;
  ladder: Ladder;
  curve: LossCurve;
  /** Loss, payout and net across the outcome range, for the profile chart. */
  profile: Array<{ value: number; lossUsd: number; payoutUsd: number; netUsd: number }>;
}

/**
 * Probe points for the profile chart.
 *
 * Bucket edges alone would hide the step: cover pays a flat amount across a
 * bucket while the loss slopes through it, and that gap is the honest
 * limitation of parametric cover. Sampling every degree across the covered
 * range draws it rather than smoothing it away.
 */
function profileRange(plan: CoverPlan, curve: LossCurve): number[] {
  const edges = plan.legs.flatMap((l) => [l.strike.floor, l.strike.cap]);
  const known = edges.filter((v): v is number => v !== null);
  const low = Math.min(...known, curve.threshold) - 6;
  const high = Math.max(...known, curve.threshold) + 6;
  const values: number[] = [];
  for (let v = Math.floor(low); v <= Math.ceil(high); v += 1) values.push(v);
  return values;
}

export async function solveClientCover(
  client: Client,
  eventTicker: string,
): Promise<CoverResult> {
  const ladder = await resolveLadder(eventTicker);
  const { curve } = await fitClientCurve(client, scaleFor(ladder));
  const history = await loadHistoryPair(client, ladder);
  const plan = solveCover({
    ladder,
    curve,
    station: history.station,
    premises: history.premises,
    ...(client.months.length > 0 && { months: client.months }),
  });
  return { plan, ladder, curve, profile: coverProfile(plan, curve, profileRange(plan, curve)) };
}

export interface BasisResult {
  measurement: ReturnType<typeof measureGeographicBasis>;
  summary: string;
  stationPoint: GeoPoint;
  premisesPoint: GeoPoint;
  /** Daily station-vs-premises pairs, thinned for plotting. */
  scatter: Array<{ station: number; premises: number }>;
}

const SCATTER_LIMIT = 600;

/** Restrict a daily series to the calendar months a business is exposed. */
function inSeasonSeries(series: DailySeries, months: number[]): DailySeries {
  if (months.length === 0) return series;
  const dates: string[] = [];
  const values: Array<number | null> = [];
  for (const [i, date] of series.dates.entries()) {
    if (!months.includes(Number(date.slice(5, 7)))) continue;
    dates.push(date);
    values.push(series.values[i] ?? null);
  }
  return { point: series.point, dates, values, unit: series.unit };
}

export async function measureClientBasis(
  client: Client,
  eventTicker: string,
): Promise<BasisResult> {
  const ladder = await resolveLadder(eventTicker);
  const { curve } = await fitClientCurve(client, scaleFor(ladder));
  const history = await loadHistoryPair(client, ladder);

  /*
   * Measure basis over the same months the cover is replayed on.
   *
   * Year-round the station and the premises agree on hundreds of winter days
   * the business is never exposed to, which inflates the loss-day count and
   * makes the two cards contradict each other — a thousand loss days here
   * against fifty in the replay directly below it.
   */
  const station = inSeasonSeries(history.station, client.months);
  const premises = inSeasonSeries(history.premises, client.months);
  const measurement = measureGeographicBasis({
    station,
    premises,
    threshold: curve.threshold,
    direction: curve.direction,
  });

  const premisesByDate = new Map<string, number>();
  for (const [i, date] of premises.dates.entries()) {
    const value = premises.values[i];
    if (value !== null && value !== undefined) premisesByDate.set(date, value);
  }
  const pairs: Array<{ station: number; premises: number }> = [];
  for (const [i, date] of station.dates.entries()) {
    const stationValue = station.values[i];
    const premisesValue = premisesByDate.get(date);
    if (stationValue !== null && stationValue !== undefined && premisesValue !== undefined) {
      pairs.push({ station: stationValue, premises: premisesValue });
    }
  }
  const stride = Math.max(1, Math.ceil(pairs.length / SCATTER_LIMIT));
  return {
    measurement,
    summary: describeGeoBasis(measurement),
    stationPoint: history.stationPoint,
    premisesPoint: history.premisesPoint,
    scatter: pairs.filter((_, i) => i % stride === 0),
  };
}

export interface PlaceSuggestion {
  label: string;
  latitude: number;
  longitude: number;
  country: string | null;
}

/**
 * Places matching a partial name, for the location field.
 *
 * Typing a city name and accepting whatever the geocoder picks first is how a
 * business ends up pinned to a city centre miles from its actual premises, and
 * cover is measured at one specific station. Offering the candidates makes the
 * choice visible.
 */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`place search failed (${response.status})`);
  const parsed = (await response.json()) as {
    results?: Array<{
      name: string;
      latitude: number;
      longitude: number;
      admin1?: string | null;
      country?: string | null;
      country_code?: string | null;
    }>;
  };
  return (parsed.results ?? []).map((r) => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country_code ?? null,
  }));
}

export interface CoveragePlace {
  location: string;
  latitude: number;
  longitude: number;
  /** Perils with at least one live event at this location. */
  perils: Peril[];
}

/**
 * Where cover actually exists right now.
 *
 * "Is my city covered?" is the first question anyone asks and the product had
 * no way to answer it except by adding a business and finding out. Only series
 * with an open event count — a listed-but-dormant ticker is not cover.
 */
export async function listCoverage(): Promise<CoveragePlace[]> {
  const cached = await getJson<{ at: number; places: CoveragePlace[] }>(COVERAGE_CACHE_KEY).catch(
    () => null,
  );
  if (cached && Date.now() - cached.at < COVERAGE_TTL_MS) return cached.places;

  const international = await polymarket.listTemperatureLadders().catch(() => []);
  const catalogue = await kalshi.listWeatherSeries();
  /*
   * Only perils with an observation series behind them.
   *
   * Coverage should promise what the product can actually deliver end to end.
   * Hurricane and tornado series are regional counts with no station reading to
   * fit a loss curve against, and their titles ("Number of named storms")
   * aren't places at all — one was surfacing as a city called "Names".
   */
  const candidates = catalogue.filter((s) => s.location !== null && isMeasurable(s.peril));

  const live = await mapWithConcurrency(candidates, EVENT_CONCURRENCY, async (series) =>
    (await hasOpenEvent(series.ticker)) ? series : null,
  );

  const intlAsSeries: WeatherSeries[] = international
    .filter((l) => l.location !== null)
    .map((l) => ({
      venue: "polymarket" as const,
      ticker: l.seriesTicker,
      title: l.title,
      peril: l.peril ?? "other",
      location: l.location,
      frequency: "daily",
      settlementSources: l.settlement.sources,
      tags: [],
    }));

  const resolved = await mapWithConcurrency(
    [...live.filter((s): s is WeatherSeries => s !== null), ...intlAsSeries],
    GEOCODE_CONCURRENCY,
    async (series) => {
      const point = await cachedGeocode(series.location as string);
      return point ? { series, point } : null;
    },
  );
  await saveGeocodeCache();

  /*
   * Merge on coordinates, not on the series title.
   *
   * Kalshi names the same city several ways — NYC and New York, LA and Los
   * Angeles, NOLA and New Orleans — so grouping by title split one city into
   * several half-covered entries. The geocoder collapses them, and the longest
   * label wins as the most readable of the aliases.
   */
  const byPoint = new Map<string, { label: string; point: GeoPoint; perils: Set<Peril> }>();
  for (const item of resolved) {
    if (!item) continue;
    const key = `${item.point.latitude.toFixed(2)},${item.point.longitude.toFixed(2)}`;
    const label = item.point.name?.split(",")[0] ?? (item.series.location as string);
    const entry = byPoint.get(key) ?? { label, point: item.point, perils: new Set<Peril>() };
    if (label.length > entry.label.length) entry.label = label;
    entry.perils.add(item.series.peril);
    byPoint.set(key, entry);
  }

  const places: CoveragePlace[] = [...byPoint.values()]
    .map((entry) => ({
      location: entry.label,
      latitude: entry.point.latitude,
      longitude: entry.point.longitude,
      perils: [...entry.perils].toSorted(),
    }))
    .toSorted((a, b) => b.perils.length - a.perils.length || a.location.localeCompare(b.location));
  await putJson(COVERAGE_CACHE_KEY, { at: Date.now(), places }).catch(() => undefined);
  return places;
}

/**
 * Ladder ids carry their venue.
 *
 * Kalshi tickers (KXHIGHCHI-26AUG03) and Polymarket slugs
 * (highest-temperature-in-london-on-august-3-2026) share no format, but relying
 * on that would be a guess. The prefix makes routing explicit.
 */
export function qualifyLadderId(venue: string, id: string): string {
  return `${venue}:${id}`;
}

async function resolveLadder(qualified: string): Promise<Ladder> {
  const [venue, ...rest] = qualified.split(":");
  const id = rest.join(":");
  if (venue === "polymarket") return polymarket.getLadder(id);
  if (venue === "kalshi") return kalshi.getLadder(id);
  // Unprefixed ids predate venue routing; treat them as Kalshi.
  return kalshi.getLadder(qualified);
}

/** The temperature scale a ladder settles in, so observations match its strikes. */
function scaleFor(ladder: Ladder): "F" | "C" {
  return ladder.rungs.find((r) => r.strike?.unit === "C") ? "C" : "F";
}

export interface CoverOption {
  seriesTicker: string;
  title: string;
  location: string | null;
  settlementSource: string | null;
  /** Kilometres from the business to the series' settlement location. */
  distanceKm: number | null;
  events: Array<{ eventTicker: string; title: string }>;
}

/**
 * Resolved place names, cached on disk.
 *
 * The series catalogue is dozens of city names that never move, so geocoding
 * them belongs in a cache that outlives the process rather than being redone on
 * every cold start.
 *
 * Only successful lookups are cached. Caching a failure was a real bug: two
 * Chicago series share the string "Chicago", one transient network error poisoned
 * it for the whole process, and the nearest — only — cover for a Chicago business
 * silently disappeared. A miss must stay retryable.
 */
const GEOCODE_CACHE_KEY = "cache/geocode";

let geocodeCache: Map<string, GeoPoint> | null = null;

async function loadGeocodeCache(): Promise<Map<string, GeoPoint>> {
  if (geocodeCache) return geocodeCache;
  const stored = await getJson<Record<string, GeoPoint>>(GEOCODE_CACHE_KEY).catch(() => null);
  geocodeCache = new Map(Object.entries(stored ?? {}));
  return geocodeCache;
}

async function saveGeocodeCache(): Promise<void> {
  if (!geocodeCache) return;
  await putJson(GEOCODE_CACHE_KEY, Object.fromEntries(geocodeCache)).catch(() => undefined);
}

/** Concurrent lookups. Higher than this and the geocoder starts dropping connections. */
const GEOCODE_CONCURRENCY = 4;

const GEOCODE_ATTEMPTS = 3;

/**
 * Concurrent Kalshi event lookups when scanning the catalogue. Higher and the
 * exchange starts dropping connections, which reads as "this city has no
 * cover" — the same failure mode that hid Chicago behind a dead ticker.
 */
const EVENT_CONCURRENCY = 4;

const EVENT_ATTEMPTS = 4;

/** Coverage turns over daily at most, and the scan is slow. */
const COVERAGE_CACHE_KEY = "cache/coverage";
const COVERAGE_TTL_MS = 60 * 60_000;

/**
 * Whether a series has anything open, retried with backoff.
 *
 * A dropped request is indistinguishable from an empty result, and treating one
 * as the other tells a broker their city has no cover when it does — Chicago
 * disappeared from the coverage list this way while answering 20/20 in
 * isolation. The scan is cached for an hour, so paying for reliability once is
 * the right trade.
 */
async function hasOpenEvent(seriesTicker: string): Promise<boolean> {
  for (let attempt = 0; attempt < EVENT_ATTEMPTS; attempt++) {
    const events = await kalshi.listEvents(seriesTicker, 1).catch(() => null);
    if (events !== null) return events.length > 0;
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  return false;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

async function cachedGeocode(place: string): Promise<GeoPoint | null> {
  const cache = await loadGeocodeCache();
  const key = place.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  for (let attempt = 0; attempt < GEOCODE_ATTEMPTS; attempt++) {
    const point = await geocode(place).catch(() => null);
    if (point) {
      cache.set(key, point);
      return point;
    }
  }
  return null;
}

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** How far away a settlement location stops being a plausible proxy. */
const MAX_DISTANCE_KM = 150;

/** Nearby series to check for open events. Bounds the event fan-out. */
const CANDIDATE_LIMIT = 8;

/** Distinct locations shown to the broker once the dead series are gone. */
const VISIBLE_LIMIT = 4;

/**
 * Ladders that could cover this client, nearest settlement location first.
 *
 * Ranking by distance rather than by matching the client's location text is
 * both more robust — a business stored as coordinates matches no series name at
 * all — and closer to what actually matters. The distance between the station
 * and the premises is the geographic half of basis risk, so the nearest live
 * ladder is genuinely the first one to look at.
 */
export async function findCoverOptions(client: Client): Promise<CoverOption[]> {
  const [premises, catalogue] = await Promise.all([
    resolvePoint(client.premises),
    kalshi.findSeries({ peril: client.peril, limit: 200 }),
  ]);

  const located = await mapWithConcurrency(
    catalogue.filter((s) => s.location !== null),
    GEOCODE_CONCURRENCY,
    async (s) => {
      const point = await cachedGeocode(s.location as string);
      return { series: s, km: point ? distanceKm(premises, point) : null };
    },
  );

  const nearby = located
    .filter((c): c is { series: (typeof located)[number]["series"]; km: number } => c.km !== null)
    .filter((c) => c.km <= MAX_DISTANCE_KM)
    .toSorted((a, b) => a.km - b.km)
    .slice(0, CANDIDATE_LIMIT);

  await saveGeocodeCache();

  const withEvents = await Promise.all(
    nearby.map(async (c) => ({
      seriesTicker: c.series.ticker,
      title: c.series.title,
      location: c.series.location,
      settlementSource: c.series.settlementSources[0]?.name ?? null,
      distanceKm: Math.round(c.km),
      events: (await kalshi.listEvents(c.series.ticker, 6).catch(() => [])).map((e) => ({
        eventTicker: qualifyLadderId("kalshi", e.eventTicker),
        title: e.title,
      })),
    })),
  );

  /*
   * Polymarket carries the rest of the world.
   *
   * Kalshi lists US weather only, so without this a business in London, Tokyo
   * or São Paulo was told no cover exists anywhere — when a fully traded daily
   * ladder was sitting there in Celsius.
   */
  const international = await polymarket.listTemperatureLadders().catch(() => []);
  const intlMatches = await mapWithConcurrency(
    international.filter((l) => l.peril === client.peril && l.location !== null),
    GEOCODE_CONCURRENCY,
    async (ladder) => {
      const point = await cachedGeocode(ladder.location as string);
      if (!point) return null;
      const km = distanceKm(premises, point);
      return km <= MAX_DISTANCE_KM ? { ladder, km } : null;
    },
  );
  await saveGeocodeCache();

  const intlOptions = intlMatches
    .filter((m): m is { ladder: Ladder; km: number } => m !== null)
    .toSorted((a, b) => a.km - b.km)
    .filter((m, i, all) => all.findIndex((o) => o.ladder.location === m.ladder.location) === i)
    .slice(0, VISIBLE_LIMIT)
    .map((m) => ({
      seriesTicker: m.ladder.seriesTicker,
      title: m.ladder.title,
      location: m.ladder.location,
      settlementSource: m.ladder.settlement.sources[0]?.name ?? null,
      distanceKm: Math.round(m.km),
      events: [
        {
          eventTicker: qualifyLadderId("polymarket", m.ladder.eventTicker),
          title: m.ladder.title,
        },
      ],
    }));

  /*
   * Drop dead series before collapsing duplicates, not after.
   *
   * Kalshi keeps superseded tickers listed next to the current generation, and
   * both resolve to the same city and therefore the same distance. Deduping
   * first let the retired series win the tie on sort order alone and shadow the
   * live one, so a Chicago business was told no cover existed while a fully
   * traded ladder sat right there.
   */
  return [...withEvents, ...intlOptions]
    .filter((s) => s.events.length > 0)
    .toSorted((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    .filter((s, i, all) => all.findIndex((o) => o.location === s.location) === i)
    .slice(0, VISIBLE_LIMIT);
}
