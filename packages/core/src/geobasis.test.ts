import { describe, expect, it } from "vitest";
import { describeGeoBasis, measureGeographicBasis } from "./geobasis.js";
import type { DailySeries } from "./observations.js";

function series(values: Array<number | null>, name: string): DailySeries {
  return {
    point: { latitude: 0, longitude: 0, name },
    dates: values.map((_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`),
    values,
    unit: "F",
  };
}

describe("measureGeographicBasis", () => {
  it("reports perfect trigger correlation when the two places agree", () => {
    const identical = [60, 65, 72, 80, 55];
    const m = measureGeographicBasis({
      station: series(identical, "station"),
      premises: series(identical, "premises"),
      threshold: 70,
      direction: "below",
    });
    expect(m.triggerCorrelation).toBe(1);
    expect(m.meanAbsDifference).toBe(0);
    expect(m.correlation).toBeCloseTo(1, 6);
    expect(m.falsePositiveDays).toBe(0);
  });

  it("catches a station that misses the loss despite tracking closely", () => {
    // The station runs 4°F warmer, so on the days the premises dip below 70 it
    // reads above and never pays — high correlation, useless cover.
    const premises = [66, 67, 68, 75, 80];
    const station = premises.map((v) => v + 4);
    const m = measureGeographicBasis({
      station: series(station, "station"),
      premises: series(premises, "premises"),
      threshold: 70,
      direction: "below",
    });
    expect(m.correlation).toBeCloseTo(1, 6);
    expect(m.lossDays).toBe(3);
    expect(m.triggerCorrelation).toBe(0);
    expect(m.meanAbsDifference).toBeCloseTo(4, 6);
  });

  it("counts days the station pays while the business was fine", () => {
    const premises = [75, 76, 77];
    const station = [65, 66, 80];
    const m = measureGeographicBasis({
      station: series(station, "station"),
      premises: series(premises, "premises"),
      threshold: 70,
      direction: "below",
    });
    expect(m.lossDays).toBe(0);
    expect(m.falsePositiveDays).toBe(2);
    expect(m.triggerCorrelation).toBe(0);
  });

  it("handles an above-threshold peril", () => {
    const m = measureGeographicBasis({
      station: series([95, 96, 70], "station"),
      premises: series([94, 97, 71], "premises"),
      threshold: 90,
      direction: "above",
    });
    expect(m.lossDays).toBe(2);
    expect(m.triggerCorrelation).toBe(1);
  });

  it("aligns on dates and skips gaps in either series", () => {
    const m = measureGeographicBasis({
      station: series([60, null, 62, 75], "station"),
      premises: series([61, 65, null, 76], "premises"),
      threshold: 70,
      direction: "below",
    });
    // Only days 1 and 4 have a reading on both sides.
    expect(m.days).toBe(2);
    expect(m.lossDays).toBe(1);
    expect(m.triggerCorrelation).toBe(1);
  });

  it("refuses when the two series barely overlap", () => {
    expect(() =>
      measureGeographicBasis({
        station: series([60, null], "station"),
        premises: series([61, 65], "premises"),
        threshold: 70,
        direction: "below",
      }),
    ).toThrow(/at least 2 overlapping days/);
  });

  it("reports max gap alongside the average", () => {
    const m = measureGeographicBasis({
      station: series([60, 61, 90], "station"),
      premises: series([60, 61, 60], "premises"),
      threshold: 70,
      direction: "below",
    });
    expect(m.maxAbsDifference).toBe(30);
    expect(m.meanAbsDifference).toBeCloseTo(10, 6);
  });
});

describe("describeGeoBasis", () => {
  it("says there is nothing to measure when the trigger never fired", () => {
    const m = measureGeographicBasis({
      station: series([80, 85, 90], "station"),
      premises: series([80, 85, 90], "premises"),
      threshold: 70,
      direction: "below",
    });
    expect(describeGeoBasis(m)).toMatch(/never triggered at the business/);
  });

  it("quantifies the gap and the catch rate", () => {
    const m = measureGeographicBasis({
      station: series([66, 67, 80], "station"),
      premises: series([65, 68, 79], "premises"),
      threshold: 70,
      direction: "below",
    });
    expect(describeGeoBasis(m)).toMatch(/crossed the trigger on 100% of the 2 days/);
  });
});
