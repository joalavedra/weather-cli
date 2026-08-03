import { describe, expect, it } from "vitest";
import { normalizeMarket, normalizeStrike, normalizeSeries } from "./kalshi.js";
import type { SeriesContext } from "./kalshi.js";

/**
 * Fixtures are verbatim rungs from KXHIGHNY-26AUG02 (NYC daily high, Aug 2
 * 2026) as returned by the live Kalshi API, trimmed to the fields the adapter
 * reads. They pin the strike semantics the normalizer depends on: `less` and
 * `greater` bounds are exclusive, `between` bounds are inclusive.
 */
const LESS_RUNG = {
  ticker: "KXHIGHNY-26AUG02-T80",
  event_ticker: "KXHIGHNY-26AUG02",
  title: "Will the **high temp in NYC** be <80° on Aug 2, 2026?",
  yes_sub_title: "79° or below",
  status: "active",
  strike_type: "less",
  cap_strike: 80,
  close_time: "2026-08-03T04:59:00Z",
  rules_primary:
    "If the highest temperature recorded in Central Park, New York for August 02, 2026 as reported by the National Weather Service's Climatological Report (Daily), is less than 80°, then the market resolves to Yes.",
  yes_bid_dollars: "0.1600",
  yes_ask_dollars: "0.1700",
  no_bid_dollars: "0.8300",
  no_ask_dollars: "0.8400",
  open_interest_fp: "397.89",
  volume_24h_fp: "398.17",
};

const BETWEEN_RUNG = {
  ticker: "KXHIGHNY-26AUG02-B80.5",
  event_ticker: "KXHIGHNY-26AUG02",
  yes_sub_title: "80° to 81°",
  status: "active",
  strike_type: "between",
  floor_strike: 80,
  cap_strike: 81,
  yes_ask_dollars: "0.4000",
  no_ask_dollars: "0.6000",
};

const GREATER_RUNG = {
  ticker: "KXHIGHNY-26AUG02-T87",
  event_ticker: "KXHIGHNY-26AUG02",
  yes_sub_title: "88° or above",
  status: "active",
  strike_type: "greater",
  floor_strike: 87,
  yes_ask_dollars: "0.0200",
  no_ask_dollars: "0.9900",
};

const CONTEXT: SeriesContext = {
  seriesTicker: "KXHIGHNY",
  peril: "high_temp",
  location: "NYC",
  sources: [{ name: "NWS Climatological Report", url: "https://forecast.weather.gov/x" }],
};

describe("normalizeStrike", () => {
  it("converts an exclusive `less` cap to the inclusive bound its label states", () => {
    expect(normalizeStrike(LESS_RUNG)).toEqual({
      type: "less",
      floor: null,
      cap: 79,
      unit: "F",
      label: "79° or below",
    });
  });

  it("converts an exclusive `greater` floor to the inclusive bound", () => {
    expect(normalizeStrike(GREATER_RUNG)).toMatchObject({
      type: "greater",
      floor: 88,
      cap: null,
    });
  });

  it("leaves `between` bounds alone because they are already inclusive", () => {
    expect(normalizeStrike(BETWEEN_RUNG)).toMatchObject({
      type: "between",
      floor: 80,
      cap: 81,
    });
  });

  it("keeps an exclusive bound for continuous units, where there is no next value", () => {
    const rainfall = {
      ticker: "KXRAINMIA-X",
      event_ticker: "KXRAINMIA",
      yes_sub_title: "0.5 inches or below",
      strike_type: "less",
      cap_strike: 0.5,
    };
    expect(normalizeStrike(rainfall)).toMatchObject({ cap: 0.5, unit: "in" });
  });

  it("returns null when the venue gives neither a type nor bounds", () => {
    expect(
      normalizeStrike({ ticker: "X", event_ticker: "E", yes_sub_title: "Yes" }),
    ).toBeNull();
  });
});

describe("normalizeMarket", () => {
  it("prices the buy side off the ask, not the last trade", () => {
    const market = normalizeMarket(LESS_RUNG, CONTEXT);
    expect(market.outcomes).toEqual(["Yes", "No"]);
    expect(market.outcomePrices).toEqual([0.17, 0.84]);
    expect(market.quotes).toEqual({ yesBid: 0.16, yesAsk: 0.17, noBid: 0.83, noAsk: 0.84 });
  });

  it("carries the settlement station and source through from the rules", () => {
    const market = normalizeMarket(LESS_RUNG, CONTEXT);
    expect(market.settlement.station).toBe("Central Park, New York");
    expect(market.settlement.sources[0]?.name).toBe("NWS Climatological Report");
  });

  it("identifies the contract by its venue ticker and links to it", () => {
    const market = normalizeMarket(LESS_RUNG, CONTEXT);
    expect(market.venue).toBe("kalshi");
    expect(market.id).toBe("KXHIGHNY-26AUG02-T80");
    expect(market.url).toContain("kalshi.com");
  });

  it("marks a contract untradeable when neither side has a live ask", () => {
    const dead = { ...LESS_RUNG, status: "active", yes_ask_dollars: "0", no_ask_dollars: "0" };
    expect(normalizeMarket(dead, CONTEXT).acceptingOrders).toBe(false);
  });

  it("marks a settled contract closed and untradeable", () => {
    const settled = { ...LESS_RUNG, status: "settled" };
    const market = normalizeMarket(settled, CONTEXT);
    expect(market.closed).toBe(true);
    expect(market.acceptingOrders).toBe(false);
  });
});

describe("normalizeSeries", () => {
  it("classifies peril and location from an inconsistent venue title", () => {
    expect(
      normalizeSeries({
        ticker: "KXHIGHNY",
        title: "Highest temperature in NYC",
        frequency: "daily",
        tags: ["Daily temperature"],
        settlement_sources: [{ name: "NWS Climatological Report", url: "https://x" }],
      }),
    ).toMatchObject({
      venue: "kalshi",
      peril: "high_temp",
      location: "NYC",
      frequency: "daily",
    });
  });

  it("defaults frequency when the venue omits it", () => {
    expect(normalizeSeries({ ticker: "KXX", title: "Rain Miami" }).frequency).toBe("custom");
  });

  it("drops settlement sources that have no name", () => {
    const series = normalizeSeries({
      ticker: "KXX",
      title: "Rain Miami",
      settlement_sources: [{ url: "https://x" }, { name: "NWS", url: null }],
    });
    expect(series.settlementSources).toEqual([{ name: "NWS", url: null }]);
  });
});
