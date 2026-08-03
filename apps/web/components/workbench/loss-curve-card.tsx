"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LossCurveChart } from "@/components/charts/loss-curve-chart";
import { Note, Stat, pct, usd } from "@/components/workbench/primitives";
import { formatTemp, ratePerDegree, tempUnitLabel, useUnits } from "@/lib/units";
import type { CurveResult } from "@/lib/analysis";

/** Below this, weather isn't what's moving the till and cover isn't warranted. */
const WEAK_FIT = 0.15;

export function LossCurveCard({
  result,
  loading,
  error,
}: {
  result: CurveResult | null;
  loading: boolean;
  error: string | null;
}) {
  const units = useUnits();
  const source = result?.curve.unit === "C" ? "C" : "F";
  const unitLabel =
    result?.curve.unit === "F" || result?.curve.unit === "C" ? tempUnitLabel(units) : "";
  const weak = result ? result.curve.rSquared < WEAK_FIT || result.curve.slopePerUnit <= 0 : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the weather costs</CardTitle>
        <CardDescription>
          Fitted from this business&apos;s own daily takings against the weather on the same days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? <Skeleton className="h-[260px] w-full" /> : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Loss starts"
                value={`${result.curve.direction === "below" ? "↓" : "↑"} ${formatTemp(result.curve.threshold, units, 1, source)}`}
              />
              <Stat
                label={`Cost per ${unitLabel || "unit"}`}
                value={usd(Math.round(ratePerDegree(result.curve.slopePerUnit, units, source)))}
                tone={result.curve.slopePerUnit > 0 ? "bad" : "default"}
              />
              <Stat label="Normal day" value={usd(Math.round(result.curve.baseline))} />
              <Stat
                label="Weather explains"
                value={pct(result.curve.rSquared)}
                tone={weak ? "warn" : "good"}
                hint={`${result.curve.observations} days`}
              />
            </div>
            {weak ? (
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertDescription>{result.summary}</AlertDescription>
              </Alert>
            ) : (
              <Note>
                Below {formatTemp(result.curve.threshold, units, 1, source)} this business loses about{" "}
                {usd(Math.round(ratePerDegree(result.curve.slopePerUnit, units, source)))} per{" "}
                {unitLabel}, and weather explains {pct(result.curve.rSquared)} of revenue swings.
              </Note>
            )}
            <LossCurveChart curve={result.curve} scatter={result.scatter} />
            <Note>
              Measured at {result.point.name ?? "the premises"}. Each dot is one day&apos;s
              takings; the line is the fitted relationship.
            </Note>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
