"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";

const config = {
  loss: { label: "What the day costs", color: "var(--chart-1)" },
  payout: { label: "What cover pays", color: "var(--chart-2)" },
  net: { label: "Net after cover", color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * The whole product in one picture: cost, payout and what's left.
 *
 * A structure that works flattens the net line. The step in the payout is the
 * honest limitation of bucketed cover — it pays the same across a bucket while
 * the loss slopes through it — and drawing it is more useful than hiding it
 * behind a single effectiveness score.
 */
export function CoverProfileChart({
  profile,
  attachment,
  unitLabel,
}: {
  profile: Array<{ value: number; lossUsdc: number; payoutUsdc: number; netUsdc: number }>;
  attachment: number;
  unitLabel: string;
}) {
  const data = profile.map((row) => ({
    value: row.value,
    loss: -row.lossUsdc,
    payout: row.payoutUsdc,
    net: row.netUsdc,
  }));

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <ComposedChart accessibilityLayer data={data} margin={{ top: 20, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="value"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v: number) => `${v}${unitLabel}`}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={(v: number) => (v === 0 ? "$0" : `$${Math.round(v).toLocaleString()}`)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => `${label}${unitLabel}`}
              formatter={(value, name) => [
                `$${Math.round(Number(value)).toLocaleString()} `,
                config[name as keyof typeof config]?.label ?? name,
              ]}
            />
          }
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ReferenceLine
          x={attachment}
          stroke="var(--chart-5)"
          strokeDasharray="4 4"
          label={{ value: "attaches", position: "top", fill: "var(--chart-5)", fontSize: 11 }}
        />
        <Area
          dataKey="loss"
          type="stepAfter"
          stroke="var(--color-loss)"
          fill="var(--color-loss)"
          fillOpacity={0.12}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Area
          dataKey="payout"
          type="stepAfter"
          stroke="var(--color-payout)"
          fill="var(--color-payout)"
          fillOpacity={0.12}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Line
          dataKey="net"
          type="stepAfter"
          stroke="var(--color-net)"
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
