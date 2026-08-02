import { describe, expect, it } from "vitest";
import {
  composeBasket,
  computeBasisRisk,
  type BasisInputs,
  type BasketLeg,
} from "./basis.js";
import type { CoverQuote } from "./types.js";

function quote(limitUsdc: number): CoverQuote {
  return {
    pricePerContract: 0.5,
    premiumUsdc: limitUsdc / 2,
    contracts: limitUsdc,
    limitUsdc,
    netIfTriggeredUsdc: limitUsdc / 2,
    exposureUsdc: null,
    coverageRatio: null,
  };
}

function inputs(over: Partial<BasisInputs> = {}): BasisInputs {
  return {
    quote: quote(10_000),
    loss: {
      lossEvent: "warehouse road freezes",
      exposureValueUsdc: 10_000,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
    },
    marketEndDate: "2026-01-20",
    triggerCorrelation: 0.8,
    correlationRationale: "Newark temp tracks the warehouse road closely.",
    ...over,
  };
}

describe("computeBasisRisk", () => {
  it("scores a well-correlated, well-timed, fully-funded hedge as tight", () => {
    const a = computeBasisRisk(inputs());
    expect(a.tenorAlignment).toBe(1);
    expect(a.payoutCoverage).toBe(1);
    expect(a.effectivenessScore).toBeCloseTo(0.8);
    expect(a.verdict).toBe("tight");
    expect(a.warnings).toHaveLength(0);
  });

  it("isolates basis-risk dollars from residual dollars", () => {
    const a = computeBasisRisk(inputs({ triggerCorrelation: 0.7 }));
    // basis risk is purely the trigger mismatch: 10k × (1 − 0.7)
    expect(a.basisRiskUsdc).toBeCloseTo(3_000);
    // residual also folds in tenor/coverage; here both are perfect so they match
    expect(a.residualRiskUsdc).toBeCloseTo(3_000);
  });

  it("separates residual from basis when payout is short", () => {
    const a = computeBasisRisk({
      ...inputs({ triggerCorrelation: 1 }),
      quote: quote(5_000),
    });
    expect(a.basisRiskUsdc).toBe(0);
    expect(a.payoutCoverage).toBe(0.5);
    expect(a.residualRiskUsdc).toBeCloseTo(5_000);
    expect(a.warnings).toContainEqual(expect.stringContaining("Underfunded"));
  });

  it("flags loose hedges with low trigger correlation", () => {
    const a = computeBasisRisk(inputs({ triggerCorrelation: 0.4 }));
    expect(a.verdict).toBe("loose");
    expect(a.warnings).toContainEqual(expect.stringContaining("High basis risk"));
  });

  it("decays tenor when the market resolves after the window", () => {
    // window is 30 days; resolving 15 days late ≈ 0.5 alignment
    const a = computeBasisRisk(inputs({ marketEndDate: "2026-02-15" }));
    expect(a.tenorAlignment).toBeCloseTo(0.5, 1);
    expect(a.warnings).toContainEqual(expect.stringContaining("Tenor gap"));
  });

  it("decays tenor when the market resolves before the window", () => {
    const a = computeBasisRisk(inputs({ marketEndDate: "2025-12-17" }));
    expect(a.tenorAlignment).toBeLessThan(1);
    expect(a.warnings).toContainEqual(expect.stringContaining("Tenor gap"));
  });

  it("gives open-ended markets partial tenor credit and a warning", () => {
    const a = computeBasisRisk(inputs({ marketEndDate: null }));
    expect(a.tenorAlignment).toBe(0.5);
    expect(a.warnings).toContainEqual(expect.stringContaining("open-ended"));
  });

  it("warns when the payout overshoots exposure", () => {
    const a = computeBasisRisk({ ...inputs(), quote: quote(20_000) });
    expect(a.payoutCoverage).toBe(1);
    expect(a.rawCoverageRatio).toBe(2);
    expect(a.warnings).toContainEqual(expect.stringContaining("Overspending"));
  });

  it("rejects an out-of-range correlation", () => {
    expect(() => computeBasisRisk(inputs({ triggerCorrelation: 1.2 }))).toThrow(
      /triggerCorrelation/,
    );
  });

  it("rejects non-positive exposure", () => {
    expect(() =>
      computeBasisRisk(
        inputs({
          loss: {
            lossEvent: "x",
            exposureValueUsdc: 0,
            windowStart: "2026-01-01",
            windowEnd: "2026-01-31",
          },
        }),
      ),
    ).toThrow(/exposureValueUsdc/);
  });

  it("rejects an unparseable window date", () => {
    expect(() =>
      computeBasisRisk(
        inputs({
          loss: {
            lossEvent: "x",
            exposureValueUsdc: 10_000,
            windowStart: "not-a-date",
            windowEnd: "2026-01-31",
          },
        }),
      ),
    ).toThrow(/valid ISO date/);
  });
});

function leg(over: Partial<BasketLeg> = {}): BasketLeg {
  return {
    marketId: "m1",
    question: "Newark temp < 20F",
    side: "Yes",
    priceUsdc: 0.5,
    triggerCorrelation: 0.6,
    correlationRationale: "proxy for the road",
    ...over,
  };
}

describe("composeBasket", () => {
  it("weights budget toward better-correlated legs and sums to the budget", () => {
    const plan = composeBasket(
      [
        leg({ marketId: "a", triggerCorrelation: 0.8 }),
        leg({ marketId: "b", triggerCorrelation: 0.4 }),
      ],
      1_200,
    );
    const a = plan.allocations.find((x) => x.leg.marketId === "a");
    const b = plan.allocations.find((x) => x.leg.marketId === "b");
    expect(a?.budgetUsdc).toBeCloseTo(800);
    expect(b?.budgetUsdc).toBeCloseTo(400);
    const total = plan.allocations.reduce((s, x) => s + x.budgetUsdc, 0);
    expect(total).toBeCloseTo(1_200);
  });

  it("diversification raises combined coverage above any single leg, capped", () => {
    const plan = composeBasket(
      [leg({ triggerCorrelation: 0.6 }), leg({ triggerCorrelation: 0.6 })],
      1_000,
    );
    // 1 − (0.4 × 0.4) = 0.84, above either leg's 0.6
    expect(plan.combinedTriggerCoverage).toBeCloseTo(0.84);
    expect(plan.combinedTriggerCoverage).toBeLessThanOrEqual(0.95);
    expect(plan.warnings[0]).toContain("independently");
  });

  it("never claims more than the 0.95 coverage cap", () => {
    const plan = composeBasket(
      [
        leg({ triggerCorrelation: 0.9 }),
        leg({ triggerCorrelation: 0.9 }),
        leg({ triggerCorrelation: 0.9 }),
      ],
      1_000,
    );
    expect(plan.combinedTriggerCoverage).toBe(0.95);
  });

  it("computes effectiveness and residual against exposure", () => {
    const plan = composeBasket([leg({ triggerCorrelation: 0.8 })], 500, 1_000);
    // one leg at price 0.5, $500 → 1000 payout → coverage 1.0
    expect(plan.combinedCoverageRatio).toBeCloseTo(1);
    expect(plan.effectivenessScore).toBeCloseTo(0.8);
    expect(plan.residualRiskUsdc).toBeCloseTo(200);
  });

  it("leaves effectiveness null when no exposure is given", () => {
    const plan = composeBasket([leg()], 500);
    expect(plan.effectivenessScore).toBeNull();
    expect(plan.residualRiskUsdc).toBeNull();
  });

  it("warns when a leg's allocation falls below its order minimum", () => {
    const plan = composeBasket(
      [
        leg({ marketId: "a", triggerCorrelation: 0.95, orderMinSizeUsdc: 10 }),
        leg({ marketId: "b", triggerCorrelation: 0.05, orderMinSizeUsdc: 10 }),
      ],
      100,
    );
    expect(plan.warnings).toContainEqual(expect.stringContaining("order minimum"));
  });

  it("warns that a one-leg basket is just a single hedge", () => {
    const plan = composeBasket([leg()], 500);
    expect(plan.warnings).toContainEqual(expect.stringContaining("basket of one"));
  });

  it("rejects a leg priced outside (0, 1)", () => {
    expect(() => composeBasket([leg({ priceUsdc: 1 })], 500)).toThrow(/price/);
  });

  it("rejects when every leg has zero correlation", () => {
    expect(() =>
      composeBasket([leg({ triggerCorrelation: 0 })], 500),
    ).toThrow(/triggerCorrelation/);
  });
});
