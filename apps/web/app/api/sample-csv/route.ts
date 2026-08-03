import { dailyHistory } from "@weather/core";
import { getJson, putJson } from "@/lib/store";
import { errorResponse } from "@/lib/http";

/**
 * A sample takings export that actually works.
 *
 * The point of the sample is that someone can download it, create a Chicago
 * business, upload it and watch the whole product run. That only holds if the
 * revenue is generated against the *real* weather the fit will pair it with —
 * a first attempt built on synthetic temperatures fitted at R² 0.05, which
 * would have taught a new user that the product doesn't work.
 */
const SAMPLE = {
  /** Central Chicago, so a business created at "Chicago" lines up. */
  latitude: 41.85,
  longitude: -87.65,
  start: "2024-04-01",
  end: "2025-09-30",
  baseline: 4200,
  weekendLift: 1300,
  costPerDegree: 120,
  threshold: 72,
} as const;

const CACHE_KEY = "cache/sample-csv";

function build(dates: string[], highs: Array<number | null>): string {
  const lines = ["date,revenue"];
  for (const [i, date] of dates.entries()) {
    const high = highs[i];
    if (high === null || high === undefined) continue;
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())
      ? SAMPLE.weekendLift
      : 0;
    const shortfall = Math.max(0, SAMPLE.threshold - high);
    // Deterministic wobble so the file is byte-identical between requests.
    const wobble = (((i * 53) % 11) - 5) * 40;
    const revenue = SAMPLE.baseline + weekend - SAMPLE.costPerDegree * shortfall + wobble;
    lines.push(`${date},${Math.max(0, revenue).toFixed(2)}`);
  }
  return lines.join("\n");
}

export async function GET(): Promise<Response> {
  try {
    const cached = await getJson<{ csv: string }>(CACHE_KEY).catch(() => null);
    const csv =
      cached?.csv ??
      (await (async () => {
        const [series] = await dailyHistory({
          points: [{ latitude: SAMPLE.latitude, longitude: SAMPLE.longitude }],
          start: SAMPLE.start,
          end: SAMPLE.end,
          peril: "high_temp",
        });
        if (!series) throw new Error("could not build the sample");
        const built = build(series.dates, series.values);
        await putJson(CACHE_KEY, { csv: built }).catch(() => undefined);
        return built;
      })());

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="sample-chicago-patio-revenue.csv"',
      },
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
