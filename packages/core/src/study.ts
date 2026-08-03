/**
 * How well does traded weather cover actually track a business?
 *
 * Every measurement taken by hand so far has disagreed with intuition, and in
 * both directions — a Chicago patio bar caught 62% of its loss days while a
 * London one caught 94%. Two points is an anecdote. This runs the same
 * measurement across every city with a live ladder so the distribution can be
 * looked at rather than guessed, because what it shows decides what the product
 * is: a broker if cover usually tracks, a diagnostic if it usually doesn't.
 */
import { measureGeographicBasis } from "./geobasis.js";
import type { GeoBasisMeasurement } from "./geobasis.js";
import * as kalshi from "./kalshi.js";
import * as polymarket from "./polymarket.js";
import { dailyHistory, geocode } from "./observations.js";
import type { GeoPoint, TemperatureScale } from "./observations.js";
import type { Ladder, VenueId } from "./types.js";

export interface StudyCase {
  venue: VenueId;
  /**
   * False when the station and the city fall in the same reanalysis grid cell,
   * so the two series are identical and the measurement is meaningless.
   */
  distinguishable: boolean;
  city: string;
  station: string;
  /** Kilometres between the settlement station and the city centre. */
  distanceKm: number;
  threshold: number;
  scale: TemperatureScale;
  measurement: GeoBasisMeasurement;
}

export interface StudyResult {
  cases: StudyCase[];
  skipped: Array<{ city: string; venue: VenueId; reason: string }>;
}

/**
 * Open-Meteo's archive is roughly 10km gridded reanalysis, so two points inside
 * one cell return byte-identical series. A zero gap is the grid failing to
 * resolve them, not two places agreeing, and counting it as a perfect hedge
 * would flatter every city with a close-in airport.
 */
const GRID_EPSILON = 0.15;

/** Beyond this the station geocoded to the wrong continent, not a real gap. */
const IMPLAUSIBLE_KM = 200;

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

const geocodeCache = new Map<string, GeoPoint | null>();

async function resolve(place: string): Promise<GeoPoint | null> {
  const key = place.toLowerCase();
  const hit = geocodeCache.get(key);
  if (hit !== undefined) return hit;
  const point = (await geocode(place).catch(() => null)) ?? (await geocode(place).catch(() => null));
  if (point) geocodeCache.set(key, point);
  return point;
}

/**
 * Locate a settlement station, falling back through simpler forms of its name.
 * Venues name stations for people, not geocoders.
 */
async function resolveStation(ladder: Ladder): Promise<GeoPoint | null> {
  const station = ladder.settlement.station;
  const bare = station?.replace(/\s+Station$/i, "");
  const attempts = [
    station,
    bare,
    bare?.replace(/\bIntl\b/i, "International"),
    bare?.replace(/\s+(?:International\s+|Intl\s+)?Airport.*$/i, ""),
    bare?.split(/[-–]/)[0],
  ].filter((v): v is string => Boolean(v && v.trim() !== ""));
  for (const attempt of attempts) {
    const point = await resolve(attempt);
    if (point) return point;
  }
  return null;
}

function percentile(values: number[], p: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[index] ?? 0;
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = Array.from({ length: items.length });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

export interface StudyArgs {
  /**
   * Where the business's loss begins, as a percentile of its own local
   * temperature distribution. 25 reads as "the coolest quarter of days hurt" —
   * a plausible threshold for a warm-weather business in any climate, which
   * makes cities comparable without inventing revenue for each.
   */
  percentile?: number;
  start?: string;
  end?: string;
  concurrency?: number;
}

/**
 * Measure basis for one ladder against the centre of the city it names.
 *
 * The premises are the city centre rather than an arbitrary offset: that is
 * where these businesses are, and the gap to the airport the contract settles
 * on is the real quantity being measured, not a parameter to tune.
 */
async function measureCase(
  ladder: Ladder,
  args: Required<Pick<StudyArgs, "percentile" | "start" | "end">>,
): Promise<StudyCase | { city: string; venue: VenueId; reason: string }> {
  const city = ladder.location;
  const fail = (reason: string) => ({ city: city ?? "?", venue: ladder.venue, reason });
  if (!city) return fail("ladder names no city");
  if (!ladder.peril) return fail("ladder has no classified peril");

  const [stationPoint, cityPoint] = await Promise.all([resolveStation(ladder), resolve(city)]);
  if (!stationPoint) return fail(`could not locate station "${ladder.settlement.station}"`);
  if (!cityPoint) return fail("could not locate the city");
  const km = distanceKm(stationPoint, cityPoint);
  if (km > IMPLAUSIBLE_KM) {
    return fail(`station resolved ${Math.round(km)}km away — wrong place`);
  }

  const scale: TemperatureScale = ladder.rungs.some((r) => r.strike?.unit === "C") ? "C" : "F";
  const [station, premises] = await dailyHistory({
    points: [stationPoint, cityPoint],
    start: args.start,
    end: args.end,
    peril: ladder.peril,
    scale,
  });
  if (!station || !premises) return fail("no observations returned");

  const observed = premises.values.filter((v): v is number => v !== null);
  if (observed.length < 200) return fail("too little history");
  const threshold = percentile(observed, args.percentile);

  const measurement = measureGeographicBasis({
    station,
    premises,
    threshold,
    direction: "below",
  });
  return {
    venue: ladder.venue,
    distinguishable: measurement.meanAbsDifference >= GRID_EPSILON,
    city,
    station: ladder.settlement.station ?? "unnamed",
    distanceKm: Math.round(km),
    threshold,
    scale,
    measurement,
  };
}

/** Every live ladder worth measuring, one per city per venue. */
async function collectLadders(): Promise<Ladder[]> {
  const [international, usSeries] = await Promise.all([
    polymarket.listTemperatureLadders().catch(() => []),
    kalshi.findSeries({ peril: "high_temp", limit: 200 }).catch(() => []),
  ]);

  const usLadders = await mapLimited(usSeries, 4, async (series) => {
    const events = await kalshi.listEvents(series.ticker, 1).catch(() => []);
    const first = events[0];
    return first ? await kalshi.getLadder(first.eventTicker).catch(() => null) : null;
  });

  const all = [
    ...international.filter((l) => l.peril === "high_temp"),
    ...usLadders.filter((l): l is Ladder => l !== null),
  ].filter((l) => l.settlement.station !== null);
  // One ladder per city per venue; the rest measure the same station twice.
  return all.filter(
    (l, i) =>
      all.findIndex((o) => o.location === l.location && o.venue === l.venue) === i &&
      l.location !== null,
  );
}

export async function runBasisStudy(args: StudyArgs = {}): Promise<StudyResult> {
  const settings = {
    percentile: args.percentile ?? 25,
    start: args.start ?? "2022-01-01",
    end: args.end ?? "2025-12-31",
  };
  const ladders = await collectLadders();
  const results = await mapLimited(ladders, args.concurrency ?? 2, (ladder) =>
    measureCase(ladder, settings),
  );
  return {
    cases: results.filter((r): r is StudyCase => "measurement" in r),
    skipped: results.filter((r): r is { city: string; venue: VenueId; reason: string } =>
      !("measurement" in r),
    ),
  };
}

export interface StudySummary {
  /** Cases where station and premises are separable in the archive. */
  n: number;
  median: number;
  /** Share of cities where cover catches at least 85% of loss days. */
  shareTight: number;
  /** Share where it catches under 70% — cover that mostly doesn't pay. */
  shareLoose: number;
  medianDistanceKm: number;
  /** Pairs the archive cannot separate, excluded from every figure above. */
  indistinguishable: number;
}

/** Below this the contract misses too much of the loss to be worth buying. */
export const LOOSE_TRIGGER = 0.7;

/** At or above this the contract tracks the business closely enough to sell. */
export const TIGHT_TRIGGER = 0.85;

/**
 * Summarize only the cases the data can actually speak to.
 *
 * Including grid-identical pairs would put the median near 100% and say nothing
 * about basis risk — it would be measuring the resolution of the weather
 * archive.
 */
function median(xs: number[]): number {
  return xs[Math.floor(xs.length / 2)] ?? 0;
}

export function summarize(all: StudyCase[]): StudySummary {
  const cases = all.filter((c) => c.distinguishable);
  const triggers = cases.map((c) => c.measurement.triggerCorrelation).toSorted((a, b) => a - b);
  const distances = cases.map((c) => c.distanceKm).toSorted((a, b) => a - b);
  return {
    n: cases.length,
    median: median(triggers),
    shareTight: cases.filter((c) => c.measurement.triggerCorrelation >= TIGHT_TRIGGER).length /
      (cases.length || 1),
    shareLoose: cases.filter((c) => c.measurement.triggerCorrelation < LOOSE_TRIGGER).length /
      (cases.length || 1),
    medianDistanceKm: median(distances),
    indistinguishable: all.length - cases.length,
  };
}
