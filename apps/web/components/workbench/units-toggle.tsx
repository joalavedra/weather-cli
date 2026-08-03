"use client";

import { Button } from "@/components/ui/button";
import type { UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";

export function UnitsToggle({
  system,
  onChange,
}: {
  system: UnitSystem;
  onChange: (next: UnitSystem) => void;
}) {
  return (
    <div className="bg-muted flex items-center rounded-md p-0.5" role="group" aria-label="Units">
      {(["imperial", "metric"] as const).map((option) => (
        <Button
          key={option}
          size="sm"
          variant="ghost"
          aria-pressed={system === option}
          onClick={() => onChange(option)}
          className={cn(
            "h-6 px-2 text-xs font-normal",
            system === option && "bg-background shadow-sm",
          )}
        >
          {option === "imperial" ? "°F" : "°C"}
        </Button>
      ))}
    </div>
  );
}
