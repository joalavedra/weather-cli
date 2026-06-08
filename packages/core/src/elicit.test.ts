import { describe, expect, it } from "vitest";
import {
  estimateTriggerCorrelation,
  type CorrelationFactors,
} from "./elicit.js";

function factors(over: Partial<CorrelationFactors> = {}): CorrelationFactors {
  return {
    geographic: { score: 0.9, note: "same metro as the warehouse" },
    peril: { score: 0.7, note: "temp drives the freeze but isn't identical" },
    threshold: { score: 0.8, note: "market <20F vs road freezes <32F" },
    ...over,
  };
}

describe("estimateTriggerCorrelation", () => {
  it("multiplies the factor scores into a combined correlation", () => {
    const e = estimateTriggerCorrelation(factors());
    expect(e.value).toBeCloseTo(0.9 * 0.7 * 0.8);
  });

  it("returns 1 only when every dimension matches perfectly", () => {
    const e = estimateTriggerCorrelation(
      factors({
        geographic: { score: 1, note: "exact" },
        peril: { score: 1, note: "exact" },
        threshold: { score: 1, note: "exact" },
      }),
    );
    expect(e.value).toBe(1);
  });

  it("collapses to zero if any dimension is unrelated", () => {
    const e = estimateTriggerCorrelation(
      factors({ peril: { score: 0, note: "totally different peril" } }),
    );
    expect(e.value).toBe(0);
  });

  it("names the weakest link", () => {
    const e = estimateTriggerCorrelation(factors());
    expect(e.weakest).toBe("peril");
    expect(e.rationale).toContain("weakest link: peril");
  });

  it("composes a rationale with each factor's percentage", () => {
    const e = estimateTriggerCorrelation(factors());
    expect(e.rationale).toContain("geographic 90%");
    expect(e.rationale).toContain("peril 70%");
    expect(e.rationale).toContain("threshold 80%");
    expect(e.rationale).toContain("50% combined");
  });

  it("rejects a score outside [0, 1]", () => {
    expect(() =>
      estimateTriggerCorrelation(
        factors({ geographic: { score: 1.5, note: "x" } }),
      ),
    ).toThrow(/geographic score/);
  });

  it("rejects an empty note", () => {
    expect(() =>
      estimateTriggerCorrelation(factors({ peril: { score: 0.5, note: "  " } })),
    ).toThrow(/note/);
  });
});
