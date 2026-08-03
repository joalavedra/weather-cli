/**
 * Historical weather observations, via Open-Meteo's archive API.
 *
 * The broker prices contracts but had no weather data of its own, which left
 * the two most important numbers in the system — how much a business actually
 * loses to weather, and how well a settlement station tracks their premises —
 * as things a model guessed at. Both are measurable from history.
 *
 * Open-Meteo's archive is free and needs no key. It is reanalysis on a grid
 * rather than the raw station record a contract settles on, so it estimates the
 * relationship between two places well but is not the settlement value itself.
 */
import { z } from "zod";
import type { Peril, StrikeUnit } from "./types.js";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const REQUEST_TIMEOUT_MS = 30_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** Resolved place name, when the point came from geocoding. */
  name?: string;
}

export interface DailySeries {
  point: GeoPoint;
  /** ISO dates, ascending. */
  dates: string[];
  /** Observed value per date; null where the archive has no reading. */
  values: Array<number | null>;
  unit: StrikeUnit;
}

/** Open-Meteo daily variable for each peril we can measure. */
const PERIL_VARIABLE: Partial<Record<Peril, string>> = {
  high_temp: "temperature_2m_max",
  low_temp: "temperature_2m_min",
  rain: "precipitation_sum",
  snow: "snowfall_sum",
};

function unitFor(peril: Peril, scale: TemperatureScale): StrikeUnit {
  return peril === "high_temp" || peril === "low_temp" ? scale : "in";
}

/** Which temperature scale observations should come back in. */
export type TemperatureScale = "F" | "C";

export function isMeasurable(peril: Peril): boolean {
  return peril in PERIL_VARIABLE;
}

async function getJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Open-Meteo GET ${url.pathname} failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }
  return (await response.json()) as unknown;
}

const GeocodeResponse = z
  .object({
    results: z
      .array(
        z
          .object({
            name: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            admin1: z.string().nullish(),
            country_code: z.string().nullish(),
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();

/**
 * Resolve a place name to coordinates. Returns null rather than throwing when
 * nothing matches, since "we don't know where that is" is an answer the broker
 * needs to relay rather than an error.
 */
export async function geocode(place: string): Promise<GeoPoint | null> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("name", place);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const parsed = GeocodeResponse.parse(await getJson(url));
  const top = parsed.results?.[0];
  if (!top) return null;
  const region = [top.admin1, top.country_code].filter(Boolean).join(", ");
  return {
    latitude: top.latitude,
    longitude: top.longitude,
    name: region === "" ? top.name : `${top.name}, ${region}`,
  };
}

const ArchiveLocation = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    daily: z
      .object({
        time: z.array(z.string()),
      })
      .catchall(z.unknown()),
  })
  .loose();

function readValues(daily: Record<string, unknown>, variable: string): Array<number | null> {
  const raw = daily[variable];
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}

/**
 * Restrict a series to a date range, inclusive of `from` and exclusive of `to`.
 * Used to hold out a period for out-of-sample evaluation.
 */
export function sliceByDate(series: DailySeries, from: string, to?: string): DailySeries {
  const dates: string[] = [];
  const values: Array<number | null> = [];
  for (const [i, date] of series.dates.entries()) {
    if (date < from) continue;
    if (to !== undefined && date >= to) continue;
    dates.push(date);
    values.push(series.values[i] ?? null);
  }
  return { point: series.point, dates, values, unit: series.unit };
}

export interface HistoryArgs {
  points: GeoPoint[];
  /** ISO date, inclusive. */
  start: string;
  /** ISO date, inclusive. */
  end: string;
  peril: Peril;
  /**
   * Scale to return temperatures in. Must match the scale the contract settles
   * in, or a threshold comparison silently compares 30°C against 30°F.
   */
  scale?: TemperatureScale;
}

/**
 * Daily observations for one or more points over a date range.
 *
 * All points go in a single request — Open-Meteo accepts comma-separated
 * coordinates and returns one object per location — so comparing a settlement
 * station against a business's premises costs one round trip, not two.
 */
export async function dailyHistory(args: HistoryArgs): Promise<DailySeries[]> {
  const scale = args.scale ?? "F";
  const variable = PERIL_VARIABLE[args.peril];
  if (!variable) {
    throw new Error(
      `no observation series for peril "${args.peril}" (measurable: ${Object.keys(PERIL_VARIABLE).join(", ")})`,
    );
  }
  if (args.points.length === 0) throw new Error("dailyHistory needs at least one point");
  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("latitude", args.points.map((p) => p.latitude).join(","));
  url.searchParams.set("longitude", args.points.map((p) => p.longitude).join(","));
  url.searchParams.set("start_date", args.start);
  url.searchParams.set("end_date", args.end);
  url.searchParams.set("daily", variable);
  url.searchParams.set("temperature_unit", scale === "C" ? "celsius" : "fahrenheit");
  url.searchParams.set("precipitation_unit", "inch");
  const raw = await getJson(url);
  const locations = z.array(ArchiveLocation).parse(Array.isArray(raw) ? raw : [raw]);
  return locations.map((loc, i) => ({
    point: args.points[i] ?? { latitude: loc.latitude, longitude: loc.longitude },
    dates: loc.daily.time,
    values: readValues(loc.daily, variable),
    unit: unitFor(args.peril, scale),
  }));
}
