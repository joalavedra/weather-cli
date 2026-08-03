import { describe, expect, it } from "vitest";
import {
  isIntegralUnit,
  locationFromTitle,
  perilFromText,
  stationFromRules,
  unitFromLabel,
} from "./weather.js";

describe("perilFromText", () => {
  it.each([
    ["Highest temperature in NYC", "high_temp"],
    ["Lowest Temperature DC", "low_temp"],
    ["Seattle Maximum Temperature Daily", "high_temp"],
    ["Rain Miami", "rain"],
    ["Chicago Snowfall Monthly", "snow"],
    ["Hurricane hits North Myrtle Beach", "hurricane"],
    ["Number of Tornadoes", "tornado"],
  ] as const)("classifies %s as %s", (title, expected) => {
    expect(perilFromText(title)).toBe(expected);
  });

  it("matches snow before temperature so snowfall series don't read as thermal", () => {
    expect(perilFromText("Denver Snow low temp Christmas")).toBe("snow");
  });

  it("does not match a peril word buried inside another word", () => {
    // Real Polymarket titles: these were being classified as rain.
    expect(perilFromText("Rainbow Six Siege: Chiefs vs TYLOO")).toBe("other");
    expect(perilFromText("Nick Fuentes and Sophie Rain confirmed relationship")).toBe("rain");
    expect(perilFromText("Will Wildcard Win EWC Rainbow Six Siege")).toBe("other");
  });

  it("still matches the ordinary inflections", () => {
    expect(perilFromText("Total rainfall in Miami")).toBe("rain");
    expect(perilFromText("Snowfall Chicago")).toBe("snow");
    expect(perilFromText("Number of Tornadoes")).toBe("tornado");
    expect(perilFromText("Windy day")).toBe("wind");
  });

  it("falls back to `other` rather than guessing a peril it can't see", () => {
    expect(perilFromText("CO2 level")).toBe("other");
    expect(perilFromText("Biggest earthquake")).toBe("other");
  });
});

describe("locationFromTitle", () => {
  it.each([
    ["Highest temperature in NYC", "NYC"],
    ["Seattle Maximum Temperature Daily", "Seattle"],
    ["San Francisco High Temperature Daily", "San Francisco"],
    ["Rain Miami", "Miami"],
    ["Lowest Temperature DC ", "DC"],
    ["Hurricane hits North Myrtle Beach", "North Myrtle Beach"],
    ["Hourly Directional Austin Temperature", "Austin"],
  ] as const)("reads %s as %s", (title, expected) => {
    expect(locationFromTitle(title)).toBe(expected);
  });

  it("strips disaster vocabulary so the place is left alone", () => {
    expect(locationFromTitle("Natural disaster hits Los Angeles")).toBe("Los Angeles");
  });

  it("returns null when nothing survives the subtraction", () => {
    expect(locationFromTitle("Daily temperature")).toBeNull();
    expect(locationFromTitle("")).toBeNull();
  });
});

describe("stationFromRules", () => {
  it("extracts the observation station a contract settles on", () => {
    const rules =
      "If the highest temperature recorded in Central Park, New York for August 02, 2026 as reported by the National Weather Service's Climatological Report (Daily), is less than 80°, then the market resolves to Yes.";
    expect(stationFromRules(rules)).toBe("Central Park, New York");
  });

  it("handles `recorded at` phrasing", () => {
    expect(stationFromRules("If snowfall recorded at Denver International Airport on Dec 25")).toBe(
      "Denver International Airport",
    );
  });

  it("extracts a station code from precipitation phrasing", () => {
    expect(
      stationFromRules(
        "If the total precipitation at CLIMIA in Miami in Aug 2026 is strictly greater than 9 inches, then the market resolves to Yes.",
      ),
    ).toBe("CLIMIA");
  });

  it("returns null rather than guessing when no station is named", () => {
    expect(stationFromRules("If the Fed cuts rates in December")).toBeNull();
    expect(stationFromRules(null)).toBeNull();
    expect(stationFromRules(undefined)).toBeNull();
  });
});

describe("unitFromLabel", () => {
  it.each([
    ["79° or below", "F"],
    ["0.5 inches or below", "in"],
    ["3 or more", "count"],
    ["Yes", null],
  ] as const)("reads %s as %s", (label, expected) => {
    expect(unitFromLabel(label)).toBe(expected);
  });
});

describe("isIntegralUnit", () => {
  it("treats temperature and counts as whole-valued, inches as continuous", () => {
    expect(isIntegralUnit("F")).toBe(true);
    expect(isIntegralUnit("count")).toBe(true);
    expect(isIntegralUnit("in")).toBe(false);
    expect(isIntegralUnit(null)).toBe(false);
  });
});
