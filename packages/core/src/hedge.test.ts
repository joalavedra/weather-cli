import { describe, expect, it } from "vitest";
import { maxPremiumForExposure, priceCover, quoteFromMarket } from "./hedge.js";
import type { Market } from "./types.js";

describe("priceCover", () => {
  it("turns a premium into contracts and a limit", () => {
    const quote = priceCover({ pricePerContract: 0.25, premiumUsdc: 250 });
    expect(quote.contracts).toBe(1000);
    expect(quote.limitUsdc).toBe(1000);
    expect(quote.netIfTriggeredUsdc).toBe(750);
  });

  it("reports coverage against stated exposure", () => {
    const quote = priceCover({
      pricePerContract: 0.5,
      premiumUsdc: 250,
      exposureUsdc: 1000,
    });
    expect(quote.coverageRatio).toBe(0.5);
    expect(quote.exposureUsdc).toBe(1000);
  });

  it("carries no return figure — premium is the cost of cover", () => {
    const quote = priceCover({ pricePerContract: 0.25, premiumUsdc: 250 });
    expect(quote).not.toHaveProperty("roiIfYesPct");
    expect(quote).not.toHaveProperty("roiIfNoPct");
    expect(quote).not.toHaveProperty("profitIfYesUsdc");
  });

  describe("the exposure invariant", () => {
    it("refuses a position that would pay more than the loss it protects", () => {
      expect(() =>
        priceCover({ pricePerContract: 0.1, premiumUsdc: 500, exposureUsdc: 1000 }),
      ).toThrow(/bet rather than cover/);
    });

    it("names the premium that would fit the exposure exactly", () => {
      expect(() =>
        priceCover({ pricePerContract: 0.1, premiumUsdc: 500, exposureUsdc: 1000 }),
      ).toThrow(/Cap the premium at \$100\.00/);
    });

    it("allows a little slack, since exposure is itself an estimate", () => {
      // $1020 of limit against $1000 exposure is within the 5% tolerance.
      expect(() =>
        priceCover({ pricePerContract: 0.5, premiumUsdc: 510, exposureUsdc: 1000 }),
      ).not.toThrow();
    });

    it("does not constrain a quote with no stated exposure", () => {
      expect(() => priceCover({ pricePerContract: 0.01, premiumUsdc: 500 })).not.toThrow();
    });
  });

  it("rejects a contract with no live market on either edge", () => {
    expect(() => priceCover({ pricePerContract: 0, premiumUsdc: 100 })).toThrow(
      /between 0 and 1 exclusive/,
    );
    expect(() => priceCover({ pricePerContract: 1, premiumUsdc: 100 })).toThrow(
      /between 0 and 1 exclusive/,
    );
  });

  it("rejects a non-positive premium", () => {
    expect(() => priceCover({ pricePerContract: 0.5, premiumUsdc: 0 })).toThrow(
      /premiumUsdc must be positive/,
    );
  });
});

describe("maxPremiumForExposure", () => {
  it("is the premium whose limit equals the exposure", () => {
    const exposure = 8000;
    const price = 0.2;
    const premium = maxPremiumForExposure(price, exposure);
    expect(priceCover({ pricePerContract: price, premiumUsdc: premium, exposureUsdc: exposure }).limitUsdc).toBe(
      exposure,
    );
  });
});

describe("quoteFromMarket", () => {
  const market = {
    id: "KXHIGHCHI-X",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.4, 0.6],
  } as Market;

  it("prices the requested side", () => {
    expect(quoteFromMarket(market, "No", 300).pricePerContract).toBe(0.6);
  });

  it("is case-insensitive about the side", () => {
    expect(quoteFromMarket(market, "yes" as "Yes", 300).pricePerContract).toBe(0.4);
  });

  it("names the outcomes it does have when asked for one it doesn't", () => {
    const oneSided = { id: "X", outcomes: ["Above"], outcomePrices: [0.5] } as Market;
    expect(() => quoteFromMarket(oneSided, "Yes", 100)).toThrow(/got: Above/);
  });

  it("enforces the exposure invariant through the market path too", () => {
    expect(() => quoteFromMarket(market, "Yes", 5000, 1000)).toThrow(/bet rather than cover/);
  });
});
