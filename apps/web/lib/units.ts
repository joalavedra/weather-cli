"use client";

/**
 * Display units.
 *
 * Kalshi settles US weather in Fahrenheit and inches, so those are the units
 * every number arrives in and the units a contract's own bucket labels are
 * written in. Nothing is converted on the way in — a contract that says
 * "75° or below" says that whatever the reader prefers, and rewriting it would
 * misquote the terms. Conversion happens at the last possible moment, on the
 * way to the screen.
 */
import { createContext, useContext } from "react";

export type UnitSystem = "imperial" | "metric";

export const UNITS_STORAGE_KEY = "weather-cover-units";

export const UnitsContext = createContext<UnitSystem>("imperial");

export function useUnits(): UnitSystem {
  return useContext(UnitsContext);
}

export function toCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

export function toMillimetres(inches: number): number {
  return inches * 25.4;
}

/** A temperature reading, converted and labelled. */
export function formatTemp(fahrenheit: number, system: UnitSystem, digits = 1): string {
  return system === "metric"
    ? `${toCelsius(fahrenheit).toFixed(digits)}°C`
    : `${Number(fahrenheit.toFixed(digits))}°F`;
}

/** Just the number, for chart data that carries its own axis label. */
export function tempValue(fahrenheit: number, system: UnitSystem): number {
  return system === "metric" ? toCelsius(fahrenheit) : fahrenheit;
}

export function tempUnitLabel(system: UnitSystem): string {
  return system === "metric" ? "°C" : "°F";
}

/**
 * Convert a per-degree rate.
 *
 * A degree Celsius is 1.8 degrees Fahrenheit, so a business losing $137 per °F
 * loses $247 per °C. Getting this backwards would understate the sensitivity by
 * nearly half, which is why it lives here rather than at each call site.
 */
export function ratePerDegree(perFahrenheit: number, system: UnitSystem): number {
  return system === "metric" ? perFahrenheit * 1.8 : perFahrenheit;
}

/** Format a value in whichever unit the underlying series uses. */
export function formatMeasure(
  value: number,
  unit: "F" | "in" | "count" | null,
  system: UnitSystem,
  digits = 1,
): string {
  if (unit === "F") return formatTemp(value, system, digits);
  if (unit === "in") {
    return system === "metric"
      ? `${toMillimetres(value).toFixed(0)}mm`
      : `${value.toFixed(digits)}in`;
  }
  return value.toFixed(digits);
}

export function measureUnitLabel(unit: "F" | "in" | "count" | null, system: UnitSystem): string {
  if (unit === "F") return tempUnitLabel(system);
  if (unit === "in") return system === "metric" ? "mm" : "in";
  return "";
}
