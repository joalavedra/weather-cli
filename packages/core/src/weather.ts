/**
 * Weather taxonomy shared by every venue adapter.
 *
 * Venues describe the same physical risk in their own vocabulary — Kalshi
 * publishes a typed series catalogue, Polymarket publishes free text. Both are
 * reduced to the same peril and location here so that basis-risk scoring
 * compares like with like regardless of where the contract trades.
 */
import type { Peril, StrikeType, StrikeUnit } from "./types.js";

const PERIL_RULES: ReadonlyArray<readonly [RegExp, Peril]> = [
  [/hurricane|\bhur\b|tropical storm|named storm/i, "hurricane"],
  [/\btornado(?:es|s)?\b/i, "tornado"],
  [/\bsnow(?:fall|s|y)?\b/i, "snow"],
  [/\brain(?:fall|s)?\b|precipitation/i, "rain"],
  [/\bwind(?:s|y)?\b/i, "wind"],
  [/highest temp|high temp|maximum temp|max temp|hottest|heatwave/i, "high_temp"],
  [/lowest temp|low temp|minimum temp|min temp|coldest|frost|freeze/i, "low_temp"],
];

/**
 * Classify text describing a contract into the physical driver it settles on.
 *
 * Order matters: snow and rain are matched before temperature so a "Snowfall"
 * series doesn't fall through to a temperature rule on a shared word.
 */
export function perilFromText(text: string): Peril {
  for (const [pattern, peril] of PERIL_RULES) {
    if (pattern.test(text)) return peril;
  }
  return "other";
}

const LOCATION_NOISE =
  /\b(highest|lowest|high|low|maximum|minimum|max|min|temp|temperature|temperatures|daily|hourly|monthly|weekly|annual|directional|rain|rainfall|snow|snowfall|precipitation|wind|hurricane|tornado|natural|disaster|emergency|hits|in|on|the|of|at|for|markets?|total|number|level|instance|will|be)\b/gi;

/**
 * Derive the settled location from a contract title by subtracting peril and
 * cadence vocabulary.
 *
 * Venue titles are inconsistent ("Highest temperature in Houston", "Seattle
 * Maximum Temperature Daily", "Rain Miami"). A hardcoded city dictionary would
 * silently drop every city a venue adds later, so whatever survives the
 * subtraction is treated as the place.
 */
export function locationFromTitle(title: string): string | null {
  const stripped = title
    .replace(LOCATION_NOISE, " ")
    .replace(/[^\p{L}\p{N}\s'’.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped === "" ? null : stripped;
}

const STATION_PATTERN =
  /\b(?:recorded|measured|reported|observed|precipitation|snowfall|temperature)\s+(?:in|at)\s+(.+?)(?:\s+(?:for|on|in|between|during)\b|,?\s+as reported|$)/i;

/**
 * Pull the observation station out of a contract's primary rule text.
 *
 * Venues phrase this several ways — "the highest temperature recorded in
 * Central Park, New York for August 02" and "the total precipitation at CLIMIA
 * in Miami in Aug 2026" — so the anchor is the measurement verb or quantity
 * rather than any single wording.
 *
 * The station is the hedge's actual observation point, and the distance between
 * it and the client's premises is the geographic half of basis risk.
 */
export function stationFromRules(rules: string | null | undefined): string | null {
  if (!rules) return null;
  const station = STATION_PATTERN.exec(rules)?.[1]?.trim();
  return station === undefined || station === "" ? null : station;
}

/**
 * Infer the measurement unit a strike is denominated in from its label.
 *
 * The scale is read explicitly rather than assumed from a degree sign, because
 * "30°" means very different weather depending on which one it is — and the two
 * venues disagree, so guessing would silently misprice every international
 * ladder.
 */
export function unitFromLabel(label: string): StrikeUnit {
  if (/°\s*C\b/i.test(label)) return "C";
  if (/°\s*F\b/i.test(label) || /°/.test(label)) return "F";
  if (/\b(?:in|inch|inches)\b|"/.test(label)) return "in";
  if (/\d/.test(label)) return "count";
  return null;
}

export function normalizeStrikeType(raw: string | null | undefined): StrikeType {
  if (raw === "less" || raw === "greater" || raw === "between") return raw;
  return "unknown";
}

/** Units that take only whole values, where an exclusive bound has a next value. */
export function isIntegralUnit(unit: StrikeUnit): boolean {
  return unit === "F" || unit === "C" || unit === "count";
}
