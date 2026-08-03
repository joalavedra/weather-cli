"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AssistantPanel } from "@/components/workbench/assistant-panel";
import { BasisCard } from "@/components/workbench/basis-card";
import { ClientSidebar } from "@/components/workbench/client-sidebar";
import { CoverCard } from "@/components/workbench/cover-card";
import { LossCurveCard } from "@/components/workbench/loss-curve-card";
import { MONTHS } from "@/components/workbench/primitives";
import { RevenueCard } from "@/components/workbench/revenue-card";
import { ThemeToggle } from "@/components/workbench/theme-toggle";
import { UnitsToggle } from "@/components/workbench/units-toggle";
import { UNITS_STORAGE_KEY, UnitsContext } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";
import { EmptyState } from "@/components/workbench/empty-state";
import * as api from "@/lib/api";
import type { BasisResult, CoverOption, CoverResult, CurveResult } from "@/lib/analysis";
import type { Client } from "@/lib/clients";
import type { DatasetSummary } from "@/lib/datasets";

/** One request's lifecycle, so every card can show its own state honestly. */
interface Async<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const idle = <T,>(): Async<T> => ({ data: null, loading: false, error: null });

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function Workbench() {
  const [clients, setClients] = useState<Client[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [units, setUnits] = useState<UnitSystem>("imperial");

  // Read the stored preference after mount so the server and client agree on
  // the first paint and the numbers don't visibly switch units.
  useEffect(() => {
    const stored = localStorage.getItem(UNITS_STORAGE_KEY);
    if (stored === "metric" || stored === "imperial") setUnits(stored);
  }, []);

  function changeUnits(next: UnitSystem) {
    setUnits(next);
    localStorage.setItem(UNITS_STORAGE_KEY, next);
  }

  const [curve, setCurve] = useState<Async<CurveResult>>(idle);
  const [options, setOptions] = useState<Async<CoverOption[]>>(idle);
  const [eventTicker, setEventTicker] = useState<string | null>(null);
  const [cover, setCover] = useState<Async<CoverResult>>(idle);
  const [basis, setBasis] = useState<Async<BasisResult>>(idle);

  const active = clients.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    void api
      .listClients()
      .then((loaded) => {
        setClients(loaded);
        setActiveId((current) => current ?? loaded[0]?.id ?? null);
      })
      .catch((error: unknown) => toast.error(message(error)));
  }, []);

  // Selecting a client resets the canvas: nothing below survives the switch.
  useEffect(() => {
    setCurve(idle);
    setOptions(idle);
    setCover(idle);
    setBasis(idle);
    setEventTicker(null);
    setDataset(null);
    if (!active) return;

    void api
      .fetchCoverOptions(active.id)
      .then((data) => setOptions({ data, loading: false, error: null }))
      .catch((error: unknown) => setOptions({ data: null, loading: false, error: message(error) }));
    setOptions({ data: null, loading: true, error: null });

    if (!active.datasetId) return;
    void api.fetchDataset(active.datasetId).then(setDataset).catch(() => undefined);
    setCurve({ data: null, loading: true, error: null });
    void api
      .fetchCurve(active.id, units === "metric" ? "C" : "F")
      .then((data) => setCurve({ data, loading: false, error: null }))
      .catch((error: unknown) => setCurve({ data: null, loading: false, error: message(error) }));
  }, [active?.id, active?.datasetId, units]);

  const pickLadder = useCallback(
    (ticker: string) => {
      if (!active) return;
      setEventTicker(ticker);
      setCover({ data: null, loading: true, error: null });
      setBasis({ data: null, loading: true, error: null });
      void api
        .fetchCover(active.id, ticker)
        .then((data) => setCover({ data, loading: false, error: null }))
        .catch((error: unknown) => setCover({ data: null, loading: false, error: message(error) }));
      void api
        .fetchBasis(active.id, ticker)
        .then((data) => setBasis({ data, loading: false, error: null }))
        .catch((error: unknown) => setBasis({ data: null, loading: false, error: message(error) }));
    },
    [active],
  );

  function onCreated(client: Client) {
    setClients((prev) => [client, ...prev]);
    setActiveId(client.id);
  }

  function onRevenueAttached(client: Client, summary: DatasetSummary) {
    setClients((prev) => prev.map((c) => (c.id === client.id ? client : c)));
    setDataset(summary);
  }

  const season =
    active && active.months.length > 0
      ? active.months.map((m) => MONTHS[m - 1]).join(" ")
      : "Year-round";

  return (
    <UnitsContext.Provider value={units}>
    <div className="flex h-screen overflow-hidden">
      <ClientSidebar
        clients={clients}
        activeId={activeId}
        onSelect={setActiveId}
        onCreated={onCreated}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
          {active ? (
            <>
              <h1 className="truncate text-sm font-semibold">{active.name}</h1>
              <Badge variant="secondary" className="font-normal">
                {active.premises}
              </Badge>
              <Badge variant="outline" className="font-normal">
                {season}
              </Badge>
            </>
          ) : (
            <h1 className="text-sm font-semibold">Weather Cover</h1>
          )}
          <div className="ml-auto flex items-center gap-2">
            <UnitsToggle system={units} onChange={changeUnits} />
            <ThemeToggle />
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
            {!active ? (
              <EmptyState />
            ) : (
              <>
                <RevenueCard
                  client={active}
                  summary={dataset}
                  onAttached={onRevenueAttached}
                />
                {active.datasetId ? (
                  <LossCurveCard
                    result={curve.data}
                    loading={curve.loading}
                    error={curve.error}
                  />
                ) : null}
                <CoverCard
                  options={options.data ?? []}
                  optionsLoading={options.loading}
                  optionsError={options.error}
                  active={eventTicker}
                  onPick={pickLadder}
                  result={cover.data}
                  loading={cover.loading}
                  error={cover.error}
                />
                {eventTicker ? (
                  <BasisCard result={basis.data} loading={basis.loading} error={basis.error} />
                ) : null}
              </>
            )}
          </div>
        </ScrollArea>
      </main>

      <AssistantPanel client={active} />
    </div>
    </UnitsContext.Provider>
  );
}
