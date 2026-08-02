import { describe, expect, it } from "vitest";
import {
  alignSamples,
  describeFit,
  expectedLoss,
  fitLossCurve,
  parseRevenueCsv,
} from "./loss.js";
import type { LossSample } from "./loss.js";
import type { DailySeries } from "./observations.js";

/**
 * Generate revenue from a known hockey stick so the fit can be checked against
 * the truth rather than against itself. Temperatures sweep a fixed range so the
 * data has support on both sides of the kink.
 */
function syntheticSamples(args: {
  threshold: number;
  slope: number;
  baseline: number;
  noise?: number;
  days?: number;
}): LossSample[] {
  const { threshold, slope, baseline } = args;
  const noise = args.noise ?? 0;
  const days = args.days ?? 120;
  const samples: LossSample[] = [];
  for (let i = 0; i < days; i++) {
    const value = 50 + (i % 45);
    const shortfall = Math.max(0, threshold - value);
    // Deterministic alternating wobble — no RNG, so the test can't flake.
    const wobble = noise === 0 ? 0 : (i % 2 === 0 ? noise : -noise);
    samples.push({ value, revenue: baseline - slope * shortfall + wobble });
  }
  return samples;
}

describe("fitLossCurve", () => {
  it("recovers the threshold and slope of a clean hockey stick", () => {
    const curve = fitLossCurve(
      syntheticSamples({ threshold: 70, slope: 80, baseline: 4000 }),
      "F",
    );
    expect(curve.direction).toBe("below");
    expect(curve.threshold).toBe(70);
    expect(curve.slopePerUnit).toBeCloseTo(80, 6);
    expect(curve.baseline).toBeCloseTo(4000, 6);
    expect(curve.rSquared).toBeCloseTo(1, 6);
  });

  it("recovers a heat-driven loss without being told the direction", () => {
    const samples = syntheticSamples({ threshold: 70, slope: 0, baseline: 4000 }).map((s) => ({
      value: s.value,
      revenue: 4000 - 50 * Math.max(0, s.value - 85),
    }));
    const curve = fitLossCurve(samples, "F");
    expect(curve.direction).toBe("above");
    expect(curve.threshold).toBe(85);
    expect(curve.slopePerUnit).toBeCloseTo(50, 6);
  });

  it("still finds the threshold when revenue is noisy", () => {
    const curve = fitLossCurve(
      syntheticSamples({ threshold: 72, slope: 100, baseline: 5000, noise: 60 }),
      "F",
    );
    expect(curve.threshold).toBeGreaterThanOrEqual(70);
    expect(curve.threshold).toBeLessThanOrEqual(74);
    expect(curve.slopePerUnit).toBeGreaterThan(80);
    expect(curve.rSquared).toBeGreaterThan(0.8);
  });

  it("reports a negative slope when the weather helps rather than hurts", () => {
    const samples = syntheticSamples({ threshold: 70, slope: -40, baseline: 3000 });
    expect(fitLossCurve(samples, "F").slopePerUnit).toBeLessThan(0);
  });

  it("refuses to fit fewer days than it can learn anything from", () => {
    expect(() => fitLossCurve(syntheticSamples({ threshold: 70, slope: 80, baseline: 4000, days: 10 }), "F")).toThrow(
      /at least 30 paired days/,
    );
  });

  it("refuses when revenue never moves", () => {
    const flat = syntheticSamples({ threshold: 70, slope: 0, baseline: 4000 });
    expect(() => fitLossCurve(flat, "F")).toThrow(/identical on every day/);
  });
});

describe("expectedLoss", () => {
  const curve = fitLossCurve(
    syntheticSamples({ threshold: 70, slope: 80, baseline: 4000 }),
    "F",
  );

  it("prices a day below the threshold at slope times the shortfall", () => {
    expect(expectedLoss(curve, 60)).toBeCloseTo(800, 6);
  });

  it("prices a day above the threshold at zero, never negative", () => {
    expect(expectedLoss(curve, 85)).toBe(0);
  });
});

describe("describeFit", () => {
  it("says plainly when weather barely explains revenue", () => {
    // Revenue is dominated by a weekday cycle; temperature moves it slightly.
    const samples: LossSample[] = [];
    for (let i = 0; i < 140; i++) {
      const value = 50 + (i % 45);
      const weekday = i % 7;
      const cycle = weekday >= 5 ? 3000 : 0;
      samples.push({ value, revenue: 4000 + cycle - 5 * Math.max(0, 70 - value) });
    }
    const weak = fitLossCurve(samples, "F");
    expect(weak.slopePerUnit).toBeGreaterThan(0);
    expect(weak.rSquared).toBeLessThan(0.15);
    expect(describeFit(weak)).toMatch(/Something else is driving the business/);
  });

  it("says cover isn't warranted when the weather helps", () => {
    const helpful = fitLossCurve(
      syntheticSamples({ threshold: 70, slope: -40, baseline: 3000 }),
      "F",
    );
    expect(describeFit(helpful)).toMatch(/doesn't hurt this business/);
  });
});

describe("parseRevenueCsv", () => {
  it("reads a plain date,revenue export and skips the header", () => {
    expect(parseRevenueCsv("date,revenue\n2026-07-01,4820.50\n2026-07-02,3100")).toEqual([
      { date: "2026-07-01", revenue: 4820.5 },
      { date: "2026-07-02", revenue: 3100 },
    ]);
  });

  it("survives currency symbols, quotes and thousands separators", () => {
    expect(parseRevenueCsv('2026-07-01,"$1,234.56"')).toEqual([
      { date: "2026-07-01", revenue: 1234.56 },
    ]);
  });

  it("handles CRLF line endings from spreadsheet exports", () => {
    expect(parseRevenueCsv("2026-07-01,100\r\n2026-07-02,200")).toHaveLength(2);
  });

  it("ignores extra trailing columns", () => {
    expect(parseRevenueCsv("2026-07-01,4820.50,covers,notes")).toEqual([
      { date: "2026-07-01", revenue: 4820.5 },
    ]);
  });

  it("skips rows whose revenue isn't a number rather than reading them as zero", () => {
    expect(parseRevenueCsv("2026-07-01,closed\n2026-07-02,200")).toEqual([
      { date: "2026-07-02", revenue: 200 },
    ]);
  });

  it("skips rows with a date it can't trust", () => {
    expect(parseRevenueCsv("07/01/2026,100\n2026-07-02,200")).toEqual([
      { date: "2026-07-02", revenue: 200 },
    ]);
  });

  it("says what it expected when nothing parses", () => {
    expect(() => parseRevenueCsv("total sales for July: 40000")).toThrow(/no usable rows found/);
  });
});

describe("alignSamples", () => {
  const series: DailySeries = {
    point: { latitude: 41.85, longitude: -87.65 },
    dates: ["2026-07-01", "2026-07-02", "2026-07-03"],
    values: [72, null, 68],
    unit: "F",
  };

  it("pairs revenue with the observation for the same date", () => {
    expect(
      alignSamples(
        [
          { date: "2026-07-01", revenue: 100 },
          { date: "2026-07-03", revenue: 80 },
        ],
        series,
      ),
    ).toEqual([
      { value: 72, revenue: 100 },
      { value: 68, revenue: 80 },
    ]);
  });

  it("drops days the archive has no reading for rather than interpolating", () => {
    expect(alignSamples([{ date: "2026-07-02", revenue: 90 }], series)).toEqual([]);
  });

  it("drops revenue days with no matching observation", () => {
    expect(alignSamples([{ date: "2025-01-01", revenue: 90 }], series)).toEqual([]);
  });
});
