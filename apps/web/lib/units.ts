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

export function toFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

/** Temperature scale the underlying number is already in. */
export type SourceScale = "F" | "C";

/**
 * Convert a reading from whatever scale it arrived in.
 *
 * Readings no longer arrive in one scale: Kalshi settles US contracts in
 * Fahrenheit and Polymarket settles international ones in Celsius, so the
 * source has to be carried alongside the number. Assuming Fahrenheit would
 * turn a 30°C London day into -1°C on screen.
 */
export function convertTemp(value: number, from: SourceScale, to: UnitSystem): number {
  const target: SourceScale = to === "metric" ? "C" : "F";
  if (from === target) return value;
  return target === "C" ? toCelsius(value) : toFahrenheit(value);
}

export function toMillimetres(inches: number): number {
  return inches * 25.4;
}

/** A temperature reading, converted and labelled. */
export function formatTemp(
  value: number,
  system: UnitSystem,
  digits = 1,
  from: SourceScale = "F",
): string {
  const converted = convertTemp(value, from, system);
  return `${Number(converted.toFixed(digits))}${tempUnitLabel(system)}`;
}

/** Just the number, for chart data that carries its own axis label. */
export function tempValue(value: number, system: UnitSystem, from: SourceScale = "F"): number {
  return convertTemp(value, from, system);
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
export function ratePerDegree(
  rate: number,
  system: UnitSystem,
  from: SourceScale = "F",
): number {
  const target: SourceScale = system === "metric" ? "C" : "F";
  if (from === target) return rate;
  return target === "C" ? rate * 1.8 : rate / 1.8;
}

/** Format a value in whichever unit the underlying series uses. */
export function formatMeasure(
  value: number,
  unit: "F" | "C" | "in" | "count" | null,
  system: UnitSystem,
  digits = 1,
): string {
  if (unit === "F" || unit === "C") return formatTemp(value, system, digits, unit);
  if (unit === "in") {
    return system === "metric"
      ? `${toMillimetres(value).toFixed(0)}mm`
      : `${value.toFixed(digits)}in`;
  }
  return value.toFixed(digits);
}

export function measureUnitLabel(
  unit: "F" | "C" | "in" | "count" | null,
  system: UnitSystem,
): string {
  if (unit === "F" || unit === "C") return tempUnitLabel(system);
  if (unit === "in") return system === "metric" ? "mm" : "in";
  return "";
}
