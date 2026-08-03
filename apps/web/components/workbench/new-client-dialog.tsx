"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MONTHS, PERILS } from "@/components/workbench/primitives";
import { createClient } from "@/lib/api";
import type { Client } from "@/lib/clients";
import type { Peril } from "@weather/core";
import { cn } from "@/lib/utils";

export function NewClientDialog({ onCreated }: { onCreated: (client: Client) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [premises, setPremises] = useState("");
  const [peril, setPeril] = useState<Peril>("high_temp");
  const [months, setMonths] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMonth(month: number) {
    setMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].toSorted((a, b) => a - b),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const client = await createClient({ name, premises, peril, months });
      onCreated(client);
      setOpen(false);
      setName("");
      setPremises("");
      setMonths([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2">
          <Plus className="size-4" /> New business
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a business</DialogTitle>
          <DialogDescription>
            Where it is and what weather hurts it. Everything else is measured from its revenue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nc-name">Name</Label>
            <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Lakeview Patio Co." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-premises">Location</Label>
            <Input id="nc-premises" value={premises} onChange={(e) => setPremises(e.target.value)}
              placeholder="Chicago — or 41.93,-87.64" />
            <p className="text-muted-foreground text-xs">
              Coordinates are worth the precision: cover is measured at a specific weather
              station, and a few miles can change what it pays.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-peril">What drives the loss</Label>
            <select id="nc-peril" value={peril} onChange={(e) => setPeril(e.target.value as Peril)}
              className="border-input bg-transparent h-9 w-full rounded-md border px-3 text-sm">
              {PERILS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Exposed months <span className="text-muted-foreground">(none = year-round)</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {MONTHS.map((label, i) => {
                const on = months.includes(i + 1);
                return (
                  <Badge
                    key={label}
                    asChild
                    variant={on ? "default" : "outline"}
                    className={cn("select-none", !on && "text-muted-foreground")}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleMonth(i + 1)}
                      className="cursor-pointer"
                    >
                      {label}
                    </button>
                  </Badge>
                );
              })}
            </div>
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy || !name.trim() || !premises.trim()}>
            {busy ? "Adding…" : "Add business"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
