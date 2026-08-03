import { CloudSun, FileUp, LineChart, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const STEPS = [
  {
    icon: MapPin,
    title: "Add the business",
    body: "Where it is and what weather hurts it. Coordinates beat a city name — cover is measured at one specific station.",
  },
  {
    icon: FileUp,
    title: "Upload a year of takings",
    body: "A date,revenue CSV from your point of sale. It stays on the server and never reaches the assistant.",
  },
  {
    icon: LineChart,
    title: "See what weather actually costs",
    body: "The threshold where takings start falling, and what each degree past it is worth — measured, not estimated.",
  },
  {
    icon: CloudSun,
    title: "Size cover against it",
    body: "Each rung sized to the loss on the days it pays, replayed on years the sizing never saw.",
  },
];

export function EmptyState() {
  return (
    <div className="space-y-6 py-8">
      <div className="max-w-xl space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          Find out what the weather costs this business
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          An ice cream shop takes about a fifth less on a cold weekend. A patio bar empties in
          the rain. Large firms have hedged that since the 1990s; small ones never could. Add a
          business on the left to start.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <Card key={step.title}>
            <CardContent className="flex gap-3 pt-6">
              <div className="bg-accent text-accent-foreground grid size-8 shrink-0 place-items-center rounded-md">
                <step.icon className="size-4" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  <span className="text-muted-foreground tnum mr-1.5">{i + 1}</span>
                  {step.title}
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
