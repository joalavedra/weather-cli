import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const PERILS = [
  { value: "high_temp", label: "Hot / cold days (daily high)" },
  { value: "low_temp", label: "Overnight lows" },
  { value: "rain", label: "Rain" },
  { value: "snow", label: "Snow" },
  { value: "hurricane", label: "Hurricane" },
  { value: "wind", label: "Wind" },
] as const;

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function usd(value: number, opts: { cents?: boolean } = {}): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })}`;
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * A single figure with its label. Values are tabular so a column of them lines
 * up, which is most of what makes a quote scannable.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </div>
      <div
        className={cn(
          "tnum text-xl leading-none font-semibold",
          tone === "good" && "text-[var(--chart-3)]",
          tone === "warn" && "text-[var(--chart-5)]",
          tone === "bad" && "text-[var(--chart-1)]",
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

/** A short explanation of what a number means, kept next to the number. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>;
}
