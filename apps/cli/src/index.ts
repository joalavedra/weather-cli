#!/usr/bin/env node
import { Command } from "commander";
import {
  computeBasisRisk,
  computeHedge,
  getVenue,
  kalshi,
  quoteFromMarket,
} from "@weather/core";
import type {
  BasisAssessment,
  CoverQuery,
  HedgeQuote,
  Ladder,
  Market,
  Peril,
  VenueId,
  WeatherSeries,
} from "@weather/core";

const program = new Command();
program
  .name("weather")
  .description("Find weather cover for a business and price it against a real loss.")
  .option("--json", "output JSON instead of tables")
  .option("--venue <name>", "venue to route through (kalshi, polymarket)", "kalshi");

interface GlobalOpts {
  json?: boolean;
  venue?: string;
}

function isJson(): boolean {
  return Boolean((program.opts() as GlobalOpts).json);
}

function venueId(): VenueId {
  const raw = (program.opts() as GlobalOpts).venue ?? "kalshi";
  if (raw !== "kalshi" && raw !== "polymarket") {
    throw new Error(`--venue must be 'kalshi' or 'polymarket', got ${raw}`);
  }
  return raw;
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatStrike(market: Market): string {
  return market.strike?.label ?? market.outcomes[0] ?? "?";
}

function printSeries(series: WeatherSeries[]): void {
  if (isJson()) return emitJson(series);
  if (series.length === 0) {
    process.stdout.write("No weather series cover that location.\n");
    return;
  }
  for (const s of series) {
    const source = s.settlementSources[0]?.name ?? "unspecified";
    process.stdout.write(`${s.ticker.padEnd(18)} ${s.title}\n`);
    process.stdout.write(
      `  peril: ${s.peril.padEnd(11)} place: ${s.location ?? "?"}   every: ${s.frequency}\n`,
    );
    process.stdout.write(`  settles on: ${source}\n\n`);
  }
}

function printMarkets(markets: Market[]): void {
  if (isJson()) return emitJson(markets);
  if (markets.length === 0) {
    process.stdout.write("No tradeable contracts found.\n");
    return;
  }
  for (const m of markets) {
    const ask = m.outcomePrices[0];
    const price = ask === undefined ? "" : `YES ${(ask * 100).toFixed(0)}¢`;
    process.stdout.write(`${m.id.padEnd(26)} ${formatStrike(m).padEnd(16)} ${price}\n`);
    process.stdout.write(
      `  ${m.peril ?? "?"} @ ${m.location ?? "?"}   open interest: ${Math.round(m.openInterest).toLocaleString()}   closes: ${m.endDate?.slice(0, 10) ?? "?"}\n`,
    );
    if (m.settlement.station) {
      process.stdout.write(`  measured at: ${m.settlement.station}\n`);
    }
    process.stdout.write("\n");
  }
}

function printLadder(ladder: Ladder): void {
  if (isJson()) return emitJson(ladder);
  process.stdout.write(`${ladder.title}\n\n`);
  process.stdout.write(`Peril:       ${ladder.peril ?? "?"}\n`);
  process.stdout.write(`Place:       ${ladder.location ?? "?"}\n`);
  process.stdout.write(`Measured at: ${ladder.settlement.station ?? "unspecified"}\n`);
  for (const source of ladder.settlement.sources) {
    process.stdout.write(`Source:      ${source.name}${source.url ? ` — ${source.url}` : ""}\n`);
  }
  process.stdout.write(`Closes:      ${ladder.closeTime?.slice(0, 16).replace("T", " ") ?? "?"}\n\n`);
  for (const rung of ladder.rungs) {
    const yes = rung.quotes.yesAsk;
    const no = rung.quotes.noAsk;
    const tradeable = rung.acceptingOrders ? "" : "  (no offers)";
    process.stdout.write(
      `  ${formatStrike(rung).padEnd(16)} YES ${(yes * 100).toFixed(0).padStart(3)}¢   NO ${(no * 100).toFixed(0).padStart(3)}¢   OI ${Math.round(rung.openInterest).toLocaleString().padStart(8)}${tradeable}\n`,
    );
  }
  process.stdout.write(`\n  ${ladder.rungs.length} rungs. Buy the buckets your loss lives in.\n`);
}

function printQuote(quote: HedgeQuote): void {
  if (isJson()) return emitJson(quote);
  const lines = [
    `Contract price:   ${(quote.yesPriceUsdc * 100).toFixed(1)}¢`,
    `Premium:          $${quote.costBudgetUsdc.toFixed(2)}`,
    `Contracts:        ${quote.sharesAffordable.toFixed(2)}`,
    `Max payout:       $${quote.maxPayoutUsdc.toFixed(2)}`,
    `If it triggers:   +$${quote.profitIfYesUsdc.toFixed(2)} net of premium`,
    `If it doesn't:    -$${quote.costBudgetUsdc.toFixed(2)} (the premium — this is the cost of cover)`,
  ];
  if (quote.exposureValueUsdc !== null && quote.coverageRatio !== null) {
    lines.push(
      `Exposure:         $${quote.exposureValueUsdc.toFixed(2)}`,
      `Coverage:         ${(quote.coverageRatio * 100).toFixed(1)}% of exposure`,
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printBasis(basis: BasisAssessment): void {
  if (isJson()) return emitJson(basis);
  const lines = [
    `Verdict:          ${basis.verdict.toUpperCase()}`,
    `Effectiveness:    ${(basis.effectivenessScore * 100).toFixed(0)}% of the real loss neutralized`,
    `Trigger corr.:    ${(basis.triggerCorrelation * 100).toFixed(0)}%  (${basis.correlationRationale})`,
    `Tenor fit:        ${(basis.tenorAlignment * 100).toFixed(0)}%`,
    `Payout coverage:  ${(basis.payoutCoverage * 100).toFixed(0)}%`,
    `Residual risk:    $${basis.residualRiskUsdc.toFixed(2)} still exposed`,
    `Basis risk:       $${basis.basisRiskUsdc.toFixed(2)} from trigger mismatch`,
  ];
  for (const w of basis.warnings) lines.push(`  ! ${w}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseSide(raw: string): "Yes" | "No" {
  const side = raw.toLowerCase();
  if (side === "yes") return "Yes";
  if (side === "no") return "No";
  throw new Error(`--side must be 'yes' or 'no', got ${raw}`);
}

function parsePeril(raw: string | undefined): Peril | undefined {
  if (raw === undefined) return undefined;
  const allowed: Peril[] = [
    "high_temp",
    "low_temp",
    "rain",
    "snow",
    "hurricane",
    "tornado",
    "wind",
    "other",
  ];
  const peril = allowed.find((p) => p === raw);
  if (!peril) {
    throw new Error(`--peril must be one of: ${allowed.join(", ")} (got ${raw})`);
  }
  return peril;
}

interface SearchOpts {
  location?: string;
  peril?: string;
  limit: string;
}

function coverQuery(opts: SearchOpts): CoverQuery {
  const peril = parsePeril(opts.peril);
  const query: CoverQuery = { limit: Number.parseInt(opts.limit, 10) };
  if (opts.location !== undefined) query.location = opts.location;
  if (peril !== undefined) query.peril = peril;
  return query;
}

program
  .command("cover")
  .description("Find the weather series that could cover a loss at a location.")
  .option("--location <place>", "where the loss happens (e.g. Chicago)")
  .option("--peril <name>", "high_temp, low_temp, rain, snow, hurricane, tornado, wind")
  .option("--limit <n>", "max results", "20")
  .action(async (opts: SearchOpts) => {
    printSeries(await kalshi.findSeries(coverQuery(opts)));
  });

program
  .command("contracts")
  .description("List tradeable weather contracts for a location, deepest book first.")
  .option("--location <place>", "where the loss happens")
  .option("--peril <name>", "restrict to one physical driver")
  .option("--limit <n>", "max results", "8")
  .action(async (opts: SearchOpts) => {
    printMarkets(await getVenue(venueId()).findWeatherMarkets(coverQuery(opts)));
  });

program
  .command("events <seriesTicker>")
  .description("List open events for a series (e.g. KXHIGHCHI).")
  .action(async (seriesTicker: string) => {
    const events = await kalshi.listEvents(seriesTicker);
    if (isJson()) return emitJson(events);
    for (const e of events) {
      process.stdout.write(`${e.eventTicker.padEnd(24)} ${e.title}\n`);
    }
  });

program
  .command("ladder <eventTicker>")
  .description("Show one event's full strike ladder (e.g. KXHIGHCHI-26AUG01).")
  .action(async (eventTicker: string) => {
    printLadder(await kalshi.getLadder(eventTicker));
  });

program
  .command("show <id>")
  .description("Show a single contract in detail, including where it settles.")
  .action(async (id: string) => {
    const market = await getVenue(venueId()).getMarket(id);
    if (isJson()) return emitJson(market);
    process.stdout.write(`${market.question}\n\n`);
    process.stdout.write(`Venue:       ${market.venue}\n`);
    process.stdout.write(`Bucket:      ${formatStrike(market)}\n`);
    process.stdout.write(`Peril:       ${market.peril ?? "?"} @ ${market.location ?? "?"}\n`);
    process.stdout.write(`Measured at: ${market.settlement.station ?? "unspecified"}\n`);
    for (const source of market.settlement.sources) {
      process.stdout.write(`Source:      ${source.name}${source.url ? ` — ${source.url}` : ""}\n`);
    }
    process.stdout.write(
      `Prices:      YES ${(market.quotes.yesAsk * 100).toFixed(0)}¢ ask / ${(market.quotes.yesBid * 100).toFixed(0)}¢ bid\n`,
    );
    process.stdout.write(`Open int.:   ${Math.round(market.openInterest).toLocaleString()}\n`);
    process.stdout.write(`Closes:      ${market.endDate?.slice(0, 10) ?? "?"}\n`);
    if (market.settlement.rules) {
      process.stdout.write(`\n${market.settlement.rules}\n`);
    }
  });

program
  .command("quote <id>")
  .description("Price cover on one contract.")
  .requiredOption("--side <yesOrNo>", "outcome to buy (Yes or No)")
  .requiredOption("--budget <usdc>", "premium you'd pay")
  .option("--exposure <usdc>", "dollars at risk if the loss happens")
  .action(async (id: string, opts: { side: string; budget: string; exposure?: string }) => {
    const market = await getVenue(venueId()).getMarket(id);
    const exposure = opts.exposure ? Number.parseFloat(opts.exposure) : undefined;
    const quote = quoteFromMarket(
      market,
      parseSide(opts.side),
      Number.parseFloat(opts.budget),
      exposure,
    );
    if (!isJson()) {
      process.stdout.write(`Cover for: ${market.question}\n`);
      process.stdout.write(`Measured at: ${market.settlement.station ?? "unspecified"}\n\n`);
    }
    printQuote(quote);
  });

program
  .command("basis <id>")
  .description("Price cover AND score its basis risk against your real loss.")
  .requiredOption("--side <yesOrNo>", "outcome to buy (Yes or No)")
  .requiredOption("--budget <usdc>", "premium you'd pay")
  .requiredOption("--exposure <usdc>", "dollars at risk if the loss happens")
  .requiredOption("--loss <text>", "your real loss in plain words")
  .requiredOption("--window-start <date>", "exposure window start (YYYY-MM-DD)")
  .requiredOption("--window-end <date>", "exposure window end (YYYY-MM-DD)")
  .requiredOption("--correlation <0to1>", "P(contract pays | your loss happens)")
  .requiredOption("--rationale <text>", "why that correlation estimate holds")
  .action(
    async (
      id: string,
      opts: {
        side: string;
        budget: string;
        exposure: string;
        loss: string;
        windowStart: string;
        windowEnd: string;
        correlation: string;
        rationale: string;
      },
    ) => {
      const market = await getVenue(venueId()).getMarket(id);
      const exposure = Number.parseFloat(opts.exposure);
      const quote = quoteFromMarket(
        market,
        parseSide(opts.side),
        Number.parseFloat(opts.budget),
        exposure,
      );
      const basis = computeBasisRisk({
        quote,
        loss: {
          lossEvent: opts.loss,
          exposureValueUsdc: exposure,
          windowStart: opts.windowStart,
          windowEnd: opts.windowEnd,
        },
        marketEndDate: market.endDate,
        triggerCorrelation: Number.parseFloat(opts.correlation),
        correlationRationale: opts.rationale,
      });
      if (!isJson()) {
        process.stdout.write(`Cover for: ${market.question}\n`);
        process.stdout.write(`Measured at: ${market.settlement.station ?? "unspecified"}\n\n`);
      }
      printQuote(quote);
      if (!isJson()) process.stdout.write("\n");
      printBasis(basis);
    },
  );

program
  .command("hedge")
  .description("Manual cover calc from raw inputs (useful for what-if).")
  .requiredOption("--price <usdc>", "contract price 0.0-1.0")
  .requiredOption("--budget <usdc>", "premium")
  .option("--exposure <usdc>", "dollars at risk")
  .action((opts: { price: string; budget: string; exposure?: string }) => {
    printQuote(
      computeHedge({
        yesPriceUsdc: Number.parseFloat(opts.price),
        costBudgetUsdc: Number.parseFloat(opts.budget),
        ...(opts.exposure ? { exposureValueUsdc: Number.parseFloat(opts.exposure) } : {}),
      }),
    );
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
