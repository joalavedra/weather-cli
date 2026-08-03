"use client";

import { CartesianGrid, Line, ComposedChart, ReferenceLine, Scatter, XAxis, YAxis } from "recharts";
import type { LossCurve } from "@weather/core";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";

const config = {
  revenue: { label: "Daily revenue", color: "var(--chart-4)" },
  fit: { label: "Fitted curve", color: "var(--chart-2)" },
} satisfies ChartConfig;

/**
 * The fitted hockey stick drawn over the actual days.
 *
 * A client should be able to falsify this by eye. An R² is a claim about their
 * business; the scatter is the evidence for it, and a fit that looks wrong on
 * the page is worth more than one that scores well.
 */
export function LossCurveChart({
  curve,
  scatter,
  unitLabel,
}: {
  curve: LossCurve;
  scatter: Array<{ value: number; revenue: number }>;
  unitLabel: string;
}) {
  const values = scatter.map((s) => s.value);
  const low = Math.floor(Math.min(...values));
  const high = Math.ceil(Math.max(...values));

  /*
   * Two points are enough to draw each arm of a piecewise-linear fit, but the
   * arm is only drawn where the model is meaningful. A hockey stick extended
   * far past the observed range implies negative takings, which is an artefact
   * of the straight line rather than a claim about the business.
   */
  const fitted = [low, curve.threshold, high]
    .map((value) => {
      const past =
        curve.direction === "below"
          ? Math.max(0, curve.threshold - value)
          : Math.max(0, value - curve.threshold);
      return { value, fit: curve.baseline - curve.slopePerUnit * past };
    })
    .filter((point) => point.fit >= 0);

  const points = scatter.map((s) => ({ value: s.value, revenue: s.revenue }));

  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <ComposedChart accessibilityLayer margin={{ top: 20, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="value"
          type="number"
          domain={[low, high]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v: number) => `${v}${unitLabel}`}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={52}
          tickFormatter={(v: number) => `$${Math.round(v / 100) / 10}k`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => `${payload?.[0]?.payload?.value}${unitLabel}`}
              formatter={(value, name) => [
                `$${Math.round(Number(value)).toLocaleString()} `,
                config[name as keyof typeof config]?.label ?? name,
              ]}
            />
          }
        />
        <ReferenceLine
          x={curve.threshold}
          stroke="var(--chart-5)"
          strokeDasharray="4 4"
          label={{
            value: `${curve.threshold}${unitLabel}`,
            position: "top",
            fill: "var(--chart-5)",
            fontSize: 11,
          }}
        />
        <Scatter data={points} dataKey="revenue" fill="var(--color-revenue)" fillOpacity={0.35} />
        <Line
          data={fitted}
          dataKey="fit"
          type="linear"
          stroke="var(--color-fit)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
