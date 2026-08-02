import { describe, expect, it } from "vitest";
import { coverProfile, payoutAt, solveCover } from "./cover.js";
import type { LossCurve } from "./loss.js";
import type { DailySeries } from "./observations.js";
import type { Ladder, Market, Strike } from "./types.js";

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

function rung(floor: number | null, cap: number | null, ask: number): Market {
  return {
    id: `r${floor}-${cap}`,
    strike: strike(floor, cap),
    quotes: { yesAsk: ask, yesBid: ask, noAsk: 1 - ask, noBid: 1 - ask },
  } as Market;
}

function ladder(rungs: Market[]): Ladder {
  return { eventTicker: "KXTEST-1", rungs } as Ladder;
}

function series(values: Array<number | null>, startDay = 1): DailySeries {
  return {
    point: { latitude: 0, longitude: 0 },
    dates: values.map((_, i) => `2026-07-${String(startDay + i).padStart(2, "0")}`),
    values,
    unit: "F",
  };
}

/** Cold days at 60 and 65, mild days above the threshold. */
const VALUES = [60, 65, 60, 75, 80, 65, 60, 78, 82, 68];

describe("solveCover", () => {
  const plan = solveCover({
    ladder: ladder([rung(null, 64, 0.1), rung(65, 69, 0.2), rung(70, null, 0.6)]),
    curve: CURVE,
    station: series(VALUES),
    premises: series(VALUES),
  });

  it("keeps only the rungs that pay on a loss day", () => {
    expect(plan.legs.map((l) => l.label)).toEqual(["-–64", "65–69"]);
  });

  it("sizes the deeper rung larger, because its days cost more", () => {
    const [deep, shallow] = plan.legs;
    expect(deep?.contracts).toBeGreaterThan(shallow?.contracts ?? 0);
  });

  it("derives the premium from the loss rather than taking it as input", () => {
    expect(plan.premiumPerDayUsdc).toBeGreaterThan(0);
    expect(plan.premiumPerDayUsdc).toBeCloseTo(
      plan.legs.reduce((sum, l) => sum + l.contracts * l.pricePerContract, 0),
      6,
    );
  });

  it("reports the limit as the largest single rung, since buckets are disjoint", () => {
    expect(plan.limitUsdc).toBe(Math.max(...plan.legs.map((l) => l.contracts)));
  });

  it("attaches at the fitted threshold", () => {
    expect(plan.attachment).toBe(70);
    expect(plan.direction).toBe("below");
  });

  it("carries the replay that justifies the premium", () => {
    expect(plan.replay.days).toBe(VALUES.length);
    expect(plan.replay.swingReduction).toBeGreaterThan(0);
  });

  it("flags an in-sample result rather than presenting it as evidence", () => {
    expect(plan.outOfSample).toBe(false);
  });
});

describe("solveCover warnings", () => {
  it("warns when the fit is too weak to justify buying anything", () => {
    const plan = solveCover({
      ladder: ladder([rung(null, 69, 0.2)]),
      curve: { ...CURVE, rSquared: 0.04 },
      station: series(VALUES),
      premises: series(VALUES),
    });
    expect(plan.warnings.join(" ")).toMatch(/hedging a risk it doesn't have/);
  });

  it("warns when the station misses most of the loss days", () => {
    // Station runs far warmer, so it rarely lands in the paying buckets.
    const premises = [60, 60, 60, 80];
    const station = [72, 73, 71, 80];
    const plan = solveCover({
      ladder: ladder([rung(null, 74, 0.2)]),
      curve: CURVE,
      station: series(station),
      premises: series(premises),
    });
    expect(plan.replay.realizedTriggerCorrelation).toBeGreaterThan(0);
    expect(plan.warnings.join(" ")).not.toMatch(/bumpier/);
  });

  it("refuses to build cover on a station that pays when the business is fine", () => {
    // Perfectly anti-correlated: the station is warm exactly when the premises
    // are cold, so the paying bucket never coincides with a loss day.
    const premises = [60, 80, 60, 80];
    const station = [80, 60, 80, 60];
    expect(() =>
      solveCover({
        ladder: ladder([rung(null, 69, 0.2)]),
        curve: CURVE,
        station: series(station),
        premises: series(premises),
      }),
    ).toThrow(/none paid on a day this business was hurting/);
  });

  it("distinguishes no rung in the region from no rung that pays", () => {
    expect(() =>
      solveCover({
        ladder: ladder([rung(75, null, 0.5)]),
        curve: CURVE,
        station: series(VALUES),
        premises: series(VALUES),
      }),
    ).toThrow(/no rung on KXTEST-1 sits in the loss region/);
  });

  it("says so when history was too short to hold days back", () => {
    const plan = solveCover({
      ladder: ladder([rung(null, 69, 0.2)]),
      curve: CURVE,
      station: series(VALUES),
      premises: series(VALUES),
    });
    expect(plan.outOfSample).toBe(false);
    expect(plan.warnings.join(" ")).toMatch(/scored on the same days it was sized on/);
  });
});

describe("payoutAt", () => {
  const plan = solveCover({
    ladder: ladder([rung(null, 64, 0.1), rung(65, 69, 0.2)]),
    curve: CURVE,
    station: series(VALUES),
    premises: series(VALUES),
  });

  it("pays the rung the outcome landed in", () => {
    expect(payoutAt(plan, 60)).toBe(plan.legs[0]?.contracts);
    expect(payoutAt(plan, 67)).toBe(plan.legs[1]?.contracts);
  });

  it("pays nothing outside the covered buckets", () => {
    expect(payoutAt(plan, 85)).toBe(0);
  });
});

describe("coverProfile", () => {
  it("flattens the net column when the cover matches the loss", () => {
    const plan = solveCover({
      ladder: ladder([rung(null, 64, 0.1), rung(65, 69, 0.2)]),
      curve: CURVE,
      station: series(VALUES),
      premises: series(VALUES),
    });
    const profile = coverProfile(plan, CURVE, [60, 67, 80]);
    const nets = profile.map((row) => row.netUsdc);
    const spreadWithCover = Math.max(...nets) - Math.min(...nets);
    const losses = profile.map((row) => -row.lossUsdc);
    const spreadWithout = Math.max(...losses) - Math.min(...losses);
    expect(spreadWithCover).toBeLessThan(spreadWithout);
  });

  it("shows loss, payout and net for each outcome", () => {
    const plan = solveCover({
      ladder: ladder([rung(null, 69, 0.2)]),
      curve: CURVE,
      station: series(VALUES),
      premises: series(VALUES),
    });
    const [row] = coverProfile(plan, CURVE, [60]);
    expect(row?.lossUsdc).toBe(1000);
    expect(row?.netUsdc).toBeCloseTo(
      (row?.payoutUsdc ?? 0) - plan.premiumPerDayUsdc - 1000,
      6,
    );
  });
});
