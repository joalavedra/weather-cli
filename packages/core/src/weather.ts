import { searchMarkets } from "./polymarket.js";
import type {
  ClassifiedMarket,
  Market,
  WeatherCategory,
} from "./types.js";

const WEATHER_KEYWORDS = [
  "weather",
  "hurricane",
  "tornado",
  "storm",
  "temperature",
  "snowfall",
  "rainfall",
  "climate",
  "heatwave",
  "frost",
] as const;

const KNOWN_CITIES = [
  "New York City",
  "NYC",
  "Tokyo",
  "Madrid",
  "Beijing",
  "Shanghai",
  "Singapore",
  "Jakarta",
  "Chongqing",
  "Chengdu",
  "Wuhan",
  "Bangkok",
  "London",
  "Paris",
  "Sao Paulo",
  "Mexico City",
  "Mumbai",
  "Delhi",
  "Hong Kong",
  "Seoul",
];

function categorize(question: string): WeatherCategory {
  const q = question.toLowerCase();
  if (q.includes("space weather") || q.includes("geomagnetic")) {
    return "space_weather";
  }
  if (q.includes("hurricane")) return "hurricane";
  if (q.includes("tornado")) return "tornado";
  if (q.includes("named storm") || q.includes("tropical storm")) return "storm";
  if (q.includes("temperature") || /\b\d+\s?°?[CF]\b/.test(question)) {
    return "temperature";
  }
  if (q.includes("climate")) return "climate";
  return "other";
}

function extractCity(question: string): string | null {
  for (const city of KNOWN_CITIES) {
    if (question.toLowerCase().includes(city.toLowerCase())) return city;
  }
  return null;
}

function isWeatherRelevant(market: Market): boolean {
  const q = market.question.toLowerCase();
  if (q.includes("rainbow six")) return false;
  return WEATHER_KEYWORDS.some((kw) => q.includes(kw)) || /\b\d+\s?°[CF]\b/.test(market.question);
}

export function classify(market: Market): ClassifiedMarket {
  return {
    ...market,
    category: categorize(market.question),
    city: extractCity(market.question),
  };
}

export async function fetchWeatherMarkets(
  options: { limitPerKeyword?: number } = {},
): Promise<ClassifiedMarket[]> {
  const limit = options.limitPerKeyword ?? 30;
  const seen = new Set<string>();
  const results: ClassifiedMarket[] = [];
  const lists = await Promise.all(
    WEATHER_KEYWORDS.map((kw) => searchMarkets(kw, limit).catch(() => [])),
  );
  for (const list of lists) {
    for (const market of list) {
      if (seen.has(market.id)) continue;
      if (market.closed) continue;
      if (!isWeatherRelevant(market)) continue;
      seen.add(market.id);
      results.push(classify(market));
    }
  }
  results.sort((a, b) => b.liquidity - a.liquidity);
  return results;
}

export async function fetchCityMarkets(
  city: string,
): Promise<ClassifiedMarket[]> {
  const all = await fetchWeatherMarkets();
  const target = city.toLowerCase();
  return all.filter((m) => m.city?.toLowerCase() === target);
}

export function listAvailableCities(
  markets: ClassifiedMarket[],
): Array<{ city: string; count: number; totalLiquidity: number }> {
  const byCity = new Map<string, { count: number; totalLiquidity: number }>();
  for (const m of markets) {
    if (!m.city) continue;
    const entry = byCity.get(m.city) ?? { count: 0, totalLiquidity: 0 };
    entry.count += 1;
    entry.totalLiquidity += m.liquidity;
    byCity.set(m.city, entry);
  }
  return Array.from(byCity.entries())
    .map(([city, v]) => ({ city, ...v }))
    .sort((a, b) => b.totalLiquidity - a.totalLiquidity);
}
