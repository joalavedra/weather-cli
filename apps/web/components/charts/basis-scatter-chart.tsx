"use client";

import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import type { StrikeUnit } from "@weather/core";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { measureUnitLabel, tempValue, useUnits } from "@/lib/units";
import type { ChartConfig } from "@/components/ui/chart";

const config = {
  days: { label: "Days", color: "var(--chart-4)" },
} satisfies ChartConfig;

/**
 * Every day plotted station against premises, with the trigger drawn on both
 * axes.
 *
 * The quadrant this reveals is the point: days sitting below the horizontal
 * line but right of the vertical one are days the business was hurting and the
 * contract didn't pay. A correlation figure hides them; this doesn't.
 */
export function BasisScatterChart({
  scatter,
  threshold,
  unit,
}: {
  scatter: Array<{ station: number; premises: number }>;
  threshold: number;
  unit: StrikeUnit;
}) {
  const units = useUnits();
  const unitLabel = measureUnitLabel(unit, units);
  const convert = (v: number) => (unit === "F" ? tempValue(v, units) : v);
  const points = scatter.map((p) => ({
    station: convert(p.station),
    premises: convert(p.premises),
  }));
  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <ScatterChart accessibilityLayer margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="station"
          name="Station"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          domain={["dataMin - 2", "dataMax + 2"]}
          tickFormatter={(v: number) => `${Math.round(v)}${unitLabel}`}
        />
        <YAxis
          type="number"
          dataKey="premises"
          name="Premises"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={52}
          domain={["dataMin - 2", "dataMax + 2"]}
          tickFormatter={(v: number) => `${Math.round(v)}${unitLabel}`}
        />
        <ZAxis range={[18, 18]} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="days"
              formatter={(value, name) => [
                `${Math.round(Number(value))}${unitLabel} `,
                name === "station" ? "at the station" : "at the premises",
              ]}
            />
          }
        />
        <ReferenceLine x={convert(threshold)} stroke="var(--chart-5)" strokeDasharray="4 4" />
        <ReferenceLine y={convert(threshold)} stroke="var(--chart-5)" strokeDasharray="4 4" />
        <Scatter data={points} fill="var(--color-days)" fillOpacity={0.4} />
      </ScatterChart>
    </ChartContainer>
  );
}
