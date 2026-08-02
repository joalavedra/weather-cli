import { describe, expect, it } from "vitest";
import {
  backtest,
  bucketContains,
  describeBacktest,
  selectLossRungs,
  sizeLegsFromHistory,
} from "./backtest.js";
import type { CoverLeg } from "./backtest.js";
import type { LossCurve } from "./loss.js";
import type { DailySeries } from "./observations.js";
import type { Ladder, Market, Strike } from "./types.js";

function series(values: Array<number | null>, startDay = 1): DailySeries {
  return {
    point: { latitude: 0, longitude: 0 },
    dates: values.map((_, i) => `2026-07-${String(startDay + i).padStart(2, "0")}`),
    values,
    unit: "F",
  };
}

const CURVE: LossCurve = {
  direction: "below",
  threshold: 70,
  slopePerUnit: 100,
  baseline: 5000,
  rSquared: 0.9,
  observations: 200,
  unit: "F",
};

function strike(floor: number | null, cap: number | null): Strike {
  return { type: "between", floor, cap, unit: "F", label: `${floor ?? "-"}–${cap ?? "+"}` };
}

/** One rung covering everything at or below 69°F, priced at 20¢. */
function coldLeg(contracts: number, price = 0.2): CoverLeg {
  return {
    label: "69° or below",
    strike: strike(null, 69),
    contracts,
    pricePerContract: price,
  };
}

describe("bucketContains", () => {
  it("includes both inclusive bounds", () => {
    expect(bucketContains(strike(70, 72), 70)).toBe(true);
    expect(bucketContains(strike(70, 72), 72)).toBe(true);
    expect(bucketContains(strike(70, 72), 69)).toBe(false);
    expect(bucketContains(strike(70, 72), 73)).toBe(false);
  });

  it("treats a null bound as unbounded on that side", () => {
    expect(bucketContains(strike(null, 69), -40)).toBe(true);
    expect(bucketContains(strike(88, null), 200)).toBe(true);
  });
});

describe("selectLossRungs", () => {
  function rung(floor: number | null, cap: number | null): Market {
    return { strike: strike(floor, cap) } as Market;
  }
  const ladder = {
    rungs: [rung(null, 69), rung(70, 71), rung(72, 73), rung(74, null)],
  } as Ladder;

  it("keeps only buckets containing values below the threshold", () => {
    // Loss starts below 70, so the 70–71 bucket holds no day that hurts.
    expect(selectLossRungs(ladder, CURVE).map((r) => r.strike?.label)).toEqual(["-–69"]);
  });

  it("keeps the upper buckets for a heat-driven loss", () => {
    // Loss starts above 71, so 70–71 holds no day that hurts either.
    const hot: LossCurve = { ...CURVE, direction: "above", threshold: 71 };
    expect(selectLossRungs(ladder, hot).map((r) => r.strike?.label)).toEqual(["72–73", "74–+"]);
  });

  it("keeps a bucket that straddles the threshold", () => {
    const straddling = { rungs: [rung(68, 71)] } as Ladder;
    // 68 and 69 fall below a 70 threshold, so this rung does pay on loss days.
    expect(selectLossRungs(straddling, CURVE).map((r) => r.strike?.label)).toEqual(["68–71"]);
  });

  it("skips rungs with no strike rather than guessing their bounds", () => {
    const noStrike = { rungs: [{ strike: null } as unknown as Market] } as Ladder;
    expect(selectLossRungs(noStrike, CURVE)).toEqual([]);
  });
});

describe("backtest", () => {
  it("offsets loss on days the station and premises agree", () => {
    // Three cold days (60°F: $1000 loss each) and two fine days.
    const values = [60, 60, 60, 80, 80];
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      station: series(values),
      premises: series(values),
      months: [],
    });
    expect(result.days).toBe(5);
    expect(result.totalLoss).toBe(3000);
    expect(result.totalPayout).toBe(3000);
    expect(result.coveredFraction).toBe(1);
    expect(result.daysHurt).toBe(3);
    expect(result.realizedTriggerCorrelation).toBe(1);
    // 1000 contracts at 20c = $200/day over 5 days
    expect(result.totalPremium).toBe(1000);
    expect(result.lossRatio).toBe(3);
  });

  it("reports the swing shrinking when cover tracks the loss", () => {
    const values = [60, 60, 80, 80, 60, 80];
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      station: series(values),
      premises: series(values),
    });
    expect(result.swingUnhedged).toBeGreaterThan(0);
    expect(result.swingHedged).toBeLessThan(result.swingUnhedged);
    expect(result.swingReduction).toBeGreaterThan(0.9);
  });

  it("shows the swing growing when the cover is uncorrelated noise", () => {
    // The station is warm exactly when the premises are cold, so payouts land
    // on the good days and the year gets bumpier rather than flatter.
    const premises = [60, 80, 60, 80];
    const station = [80, 60, 80, 60];
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      station: series(station),
      premises: series(premises),
    });
    expect(result.daysHurtAndPaid).toBe(0);
    expect(result.realizedTriggerCorrelation).toBe(0);
    expect(result.swingReduction).toBeLessThan(0);
  });

  it("counts a station that misses the loss entirely", () => {
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      // Premises dip below 70; the station stays just above and never pays.
      station: series([71, 72, 71]),
      premises: series([65, 66, 64]),
    });
    expect(result.daysHurt).toBe(3);
    expect(result.totalPayout).toBe(0);
    expect(result.coveredFraction).toBe(0);
    expect(result.lossRatio).toBe(0);
  });

  it("restricts the replay to the months the business is exposed", () => {
    const station: DailySeries = {
      point: { latitude: 0, longitude: 0 },
      dates: ["2026-01-15", "2026-07-15", "2026-07-16"],
      values: [60, 60, 60],
      unit: "F",
    };
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      station,
      premises: station,
      months: [7],
    });
    expect(result.days).toBe(2);
  });

  it("drops days missing from either series", () => {
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      station: series([60, null, 60]),
      premises: series([60, 60, null]),
    });
    expect(result.days).toBe(1);
  });

  it("refuses when nothing overlaps", () => {
    expect(() =>
      backtest({
        legs: [coldLeg(1000)],
        curve: CURVE,
        station: series([60, 60]),
        premises: series([60, 60], 20),
      }),
    ).toThrow(/no overlapping days/);
  });

  it("returns a null loss ratio rather than dividing by a zero premium", () => {
    const result = backtest({
      legs: [coldLeg(1000, 0)],
      curve: CURVE,
      station: series([60, 80]),
      premises: series([60, 80]),
    });
    expect(result.lossRatio).toBeNull();
  });

  it("improves the worst day when the cover pays on it", () => {
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      station: series([50, 80]),
      premises: series([50, 80]),
    });
    // Unhedged worst day is -$2000; cover pays $1000 less $200 premium.
    expect(result.worstDayUnhedged).toBe(-2000);
    expect(result.worstDayHedged).toBe(-1200);
  });
});

describe("sizeLegsFromHistory", () => {
  function pricedRung(floor: number | null, cap: number | null, ask: number): Market {
    return { id: `r-${floor}-${cap}`, strike: strike(floor, cap), quotes: { yesAsk: ask } } as Market;
  }

  it("sizes each rung to the loss expected on the days it pays", () => {
    // Days at 60°F cost $1000; days at 71°F cost zero under a 70 threshold.
    const values = [60, 60, 71, 71, 80];
    const legs = sizeLegsFromHistory({
      rungs: [pricedRung(null, 69, 0.2), pricedRung(70, 72, 0.3)],
      curve: CURVE,
      station: series(values),
      premises: series(values),
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.contracts).toBe(1000);
    expect(legs[0]?.pricePerContract).toBe(0.2);
  });

  it("gives the deeper bucket more contracts than the shallow one", () => {
    const values = [55, 60, 65, 68, 71, 80];
    const legs = sizeLegsFromHistory({
      rungs: [pricedRung(null, 64, 0.1), pricedRung(65, 69, 0.2)],
      curve: CURVE,
      station: series(values),
      premises: series(values),
    });
    expect(legs).toHaveLength(2);
    expect(legs[0]?.contracts).toBeGreaterThan(legs[1]?.contracts ?? 0);
  });

  it("skips rungs that never pay on a loss day", () => {
    const values = [60, 80, 80];
    const legs = sizeLegsFromHistory({
      rungs: [pricedRung(75, null, 0.5)],
      curve: CURVE,
      station: series(values),
      premises: series(values),
    });
    expect(legs).toEqual([]);
  });

  it("skips rungs with no live ask rather than pricing them at zero", () => {
    const values = [60, 60, 80];
    const legs = sizeLegsFromHistory({
      rungs: [pricedRung(null, 69, 0)],
      curve: CURVE,
      station: series(values),
      premises: series(values),
    });
    expect(legs).toEqual([]);
  });

  it("smooths the swing better than a flat contract count", () => {
    const values = [55, 60, 65, 68, 71, 80, 58, 62, 75, 82];
    const rungs = [pricedRung(null, 64, 0.1), pricedRung(65, 69, 0.2)];
    const station = series(values);
    const solved = backtest({
      legs: sizeLegsFromHistory({ rungs, curve: CURVE, station, premises: station }),
      curve: CURVE,
      station,
      premises: station,
    });
    const flat = backtest({
      legs: rungs.map((r) => ({
        label: r.strike?.label ?? "",
        strike: r.strike as Strike,
        contracts: 500,
        pricePerContract: r.quotes.yesAsk,
      })),
      curve: CURVE,
      station,
      premises: station,
    });
    expect(solved.swingReduction).toBeGreaterThan(flat.swingReduction);
  });

  it("refuses when there is no overlapping history to size against", () => {
    expect(() =>
      sizeLegsFromHistory({
        rungs: [pricedRung(null, 69, 0.2)],
        curve: CURVE,
        station: series([60, 60]),
        premises: series([60, 60], 20),
      }),
    ).toThrow(/no overlapping days/);
  });
});

describe("describeBacktest", () => {
  it("says there was nothing to do when the loss never triggered", () => {
    const result = backtest({
      legs: [coldLeg(1000)],
      curve: CURVE,
      station: series([80, 85]),
      premises: series([80, 85]),
    });
    expect(describeBacktest(result)).toMatch(/never crossed its loss threshold/);
  });

  it("reports smoothing, coverage and the worst day", () => {
    const values = [60, 80, 60, 80];
    const text = describeBacktest(
      backtest({
        legs: [coldLeg(1000)],
        curve: CURVE,
        station: series(values),
        premises: series(values),
      }),
    );
    expect(text).toMatch(/smoothed \d+% of the daily swing/);
    expect(text).toMatch(/paid on 2 of the 2 days that actually hurt/);
  });
});
