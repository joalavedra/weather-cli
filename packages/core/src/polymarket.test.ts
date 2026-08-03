import { describe, expect, it } from "vitest";
import { locationFromEvent, normalizeLadder, parseStation, parseStrike } from "./polymarket.js";

/**
 * Fixtures are verbatim from the live Gamma API for the London 3 Aug 2026
 * ladder. Polymarket states bucket bounds in prose rather than in fields, so
 * these strings are effectively the schema.
 */
const DESCRIPTION =
  "This market will resolve to the temperature range that contains the highest temperature recorded at the London City Airport Station in degrees Celsius on 3 Aug '26.\n\nThe resolution source for this market will be information from Wunderground, specifically the highest temperature recorded for all times on this day for the London City Airport Station, available here: https://www.wunderground.com/history/daily/gb/london/EGLC.";

describe("parseStrike", () => {
  it("reads an open-ended lower bucket", () => {
    expect(parseStrike("Will the highest temperature in London be 25°C or below on August 3?")).toEqual(
      { type: "less", floor: null, cap: 25, unit: "C", label: "25°C or below" },
    );
  });

  it("reads an open-ended upper bucket", () => {
    expect(
      parseStrike("Will the highest temperature in London be 35°C or higher on August 3?"),
    ).toMatchObject({ type: "greater", floor: 35, cap: null, unit: "C" });
  });

  it("treats a bare degree as a single-degree bucket, not a threshold", () => {
    // This is the one that matters: read as "30 or above" the rung would pay on
    // every hot day instead of exactly one, and the structure would be nonsense.
    expect(parseStrike("Will the highest temperature in London be 30°C on August 3?")).toMatchObject(
      { type: "between", floor: 30, cap: 30, unit: "C" },
    );
  });

  it("keeps Fahrenheit markets in Fahrenheit", () => {
    expect(parseStrike("Will the highest temperature in Chicago be 80°F on August 3?")).toMatchObject(
      { unit: "F", floor: 80, cap: 80 },
    );
  });

  it("handles a negative bucket", () => {
    expect(parseStrike("Will the lowest temperature in Moscow be -5°C on January 3?")).toMatchObject(
      { floor: -5, cap: -5, unit: "C" },
    );
  });

  it("returns null when the question states no bucket", () => {
    expect(parseStrike("Will it rain in London tomorrow?")).toBeNull();
  });
});

describe("parseStation", () => {
  it("extracts the airport station the market settles on", () => {
    expect(parseStation(DESCRIPTION)).toBe("London City Airport Station");
  });

  it("returns null rather than guessing when no station is named", () => {
    expect(parseStation("This market resolves to the winner of the election.")).toBeNull();
    expect(parseStation(null)).toBeNull();
  });
});

describe("locationFromEvent", () => {
  it("reads the city from the series slug", () => {
    expect(
      locationFromEvent({ id: "1", slug: "x", title: "t", seriesSlug: "hong-kong-daily-weather" }),
    ).toBe("Hong Kong");
  });

  it("handles the lowest-temperature series naming", () => {
    expect(
      locationFromEvent({
        id: "1",
        slug: "x",
        title: "t",
        seriesSlug: "tokyo-daily-lowest-temperature",
      }),
    ).toBe("Tokyo");
  });

  it("falls back to the title when there is no series", () => {
    expect(
      locationFromEvent({
        id: "1",
        slug: "x",
        title: "Highest temperature in Buenos Aires on August 3?",
      }),
    ).toBe("Buenos Aires");
  });
});

describe("normalizeLadder", () => {
  const event = {
    id: "e1",
    slug: "highest-temperature-in-london-on-august-3-2026",
    title: "Highest temperature in London on August 3?",
    seriesSlug: "london-daily-weather",
    endDate: "2026-08-03T12:00:00Z",
    markets: [
      {
        id: "m2",
        question: "Will the highest temperature in London be 30°C on August 3?",
        description: DESCRIPTION,
        bestAsk: 0.62,
        bestBid: 0.6,
      },
      {
        id: "m1",
        question: "Will the highest temperature in London be 25°C or below on August 3?",
        description: DESCRIPTION,
        bestAsk: 0.001,
        bestBid: 0.0005,
      },
    ],
  };

  it("sorts rungs by strike regardless of the order they arrive in", () => {
    expect(normalizeLadder(event).rungs.map((r) => r.strike?.label)).toEqual([
      "25°C or below",
      "30°C",
    ]);
  });

  it("carries the peril, city and settlement station onto the ladder", () => {
    const ladder = normalizeLadder(event);
    expect(ladder.peril).toBe("high_temp");
    expect(ladder.location).toBe("London");
    expect(ladder.settlement.station).toBe("London City Airport Station");
    expect(ladder.settlement.sources[0]?.name).toBe("Wunderground");
  });

  it("marks a rung with no live ask untradeable", () => {
    const dead = { ...event, markets: [{ ...event.markets[0], bestAsk: 0 }] };
    expect(normalizeLadder(dead).rungs[0]?.acceptingOrders).toBe(false);
  });
});
