#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  alignSamples,
  backtest,
  computeBasisRisk,
  priceCover,
  dailyHistory,
  describeFit,
  describeGeoBasis,
  fitLossCurve,
  geocode,
  getVenue,
  kalshi,
  describeBacktest,
  measureGeographicBasis,
  quoteFromMarket,
  coverProfile,
  selectLossRungs,
  sizeLegsFromHistory,
  solveCover,
} from "@weather/core";
import type {
  BasisAssessment,
  CoverLeg,
  CoverQuery,
  GeoPoint,
  RevenueDay,
  CoverQuote,
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

function printQuote(quote: CoverQuote): void {
  if (isJson()) return emitJson(quote);
  const lines = [
    `Contract price:   ${(quote.pricePerContract * 100).toFixed(1)}¢`,
    `Premium:          $${quote.premiumUsdc.toFixed(2)}`,
    `Contracts:        ${quote.contracts.toFixed(2)}`,
    `Cover limit:      $${quote.limitUsdc.toFixed(2)}`,
    `Net if triggered: +$${quote.netIfTriggeredUsdc.toFixed(2)} after premium`,
  ];
  if (quote.exposureUsdc !== null && quote.coverageRatio !== null) {
    lines.push(
      `Exposure:         $${quote.exposureUsdc.toFixed(2)}`,
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

/**
 * Parse a `date,revenue` CSV export. Deliberately minimal: this is the shape
 * every POS export (Square, Toast, Shopify, Stripe) can produce, and asking for
 * anything richer puts a data-cleaning chore between an owner and an answer.
 */
function parseRevenueCsv(text: string): RevenueDay[] {
  const rows: RevenueDay[] = [];
  for (const line of text.split("\n")) {
    const [rawDate, rawRevenue] = line.split(",", 2);
    const date = rawDate?.trim();
    const revenue = Number.parseFloat(rawRevenue ?? "");
    if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(revenue)) continue;
    rows.push({ date, revenue });
  }
  if (rows.length === 0) {
    throw new Error("no usable rows found — expected lines of the form 2026-07-01,4820.50");
  }
  return rows;
}

async function resolvePoint(place: string): Promise<GeoPoint> {
  const coords = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(place.trim());
  if (coords) {
    return { latitude: Number(coords[1]), longitude: Number(coords[2]), name: place };
  }
  const point = await geocode(place);
  if (!point) throw new Error(`could not find a place called "${place}"`);
  return point;
}

program
  .command("fit")
  .description("Fit a loss curve from your own daily revenue against the weather.")
  .requiredOption("--revenue <csv>", "path to a date,revenue CSV")
  .requiredOption("--location <place>", "where the business is (name or lat,lon)")
  .option("--peril <name>", "which driver to test against", "high_temp")
  .option("--direction <belowOrAbove>", "force a direction instead of testing both")
  .action(
    async (opts: {
      revenue: string;
      location: string;
      peril: string;
      direction?: string;
    }) => {
      const peril = parsePeril(opts.peril) ?? "high_temp";
      const rows = parseRevenueCsv(await readFile(opts.revenue, "utf8"));
      const point = await resolvePoint(opts.location);
      const dates = rows.map((r) => r.date).toSorted();
      const [series] = await dailyHistory({
        points: [point],
        start: dates[0] ?? "",
        end: dates.at(-1) ?? "",
        peril,
      });
      if (!series) throw new Error("no observations returned for that location");
      const samples = alignSamples(rows, series);
      const direction =
        opts.direction === "below" || opts.direction === "above" ? opts.direction : undefined;
      const curve = fitLossCurve(samples, series.unit, direction);
      if (isJson()) return emitJson({ point, curve, describe: describeFit(curve) });
      process.stdout.write(`Business at:      ${point.name ?? opts.location}\n`);
      process.stdout.write(`Paired days:      ${curve.observations} of ${rows.length} revenue rows\n\n`);
      process.stdout.write(`Loss starts:      ${curve.direction} ${curve.threshold}${curve.unit === "F" ? "°F" : ""}\n`);
      process.stdout.write(`Sensitivity:      $${curve.slopePerUnit.toFixed(0)} per ${curve.unit === "F" ? "°F" : "unit"}\n`);
      process.stdout.write(`Baseline revenue: $${curve.baseline.toFixed(0)}/day\n`);
      process.stdout.write(`Explained:        ${(curve.rSquared * 100).toFixed(0)}% of revenue swings\n\n`);
      process.stdout.write(`${describeFit(curve)}\n`);
    },
  );

program
  .command("station-basis")
  .description("Measure how well a settlement station tracks your actual location.")
  .requiredOption("--station <place>", "the contract's station (name or lat,lon)")
  .requiredOption("--premises <place>", "your location (name or lat,lon)")
  .requiredOption("--threshold <value>", "the trigger level")
  .option("--direction <belowOrAbove>", "which side hurts", "below")
  .option("--peril <name>", "driver to compare", "high_temp")
  .option("--start <date>", "history start (YYYY-MM-DD)", "2022-01-01")
  .option("--end <date>", "history end (YYYY-MM-DD)", "2025-12-31")
  .action(
    async (opts: {
      station: string;
      premises: string;
      threshold: string;
      direction: string;
      peril: string;
      start: string;
      end: string;
    }) => {
      if (opts.direction !== "below" && opts.direction !== "above") {
        throw new Error(`--direction must be 'below' or 'above', got ${opts.direction}`);
      }
      const [station, premises] = await Promise.all([
        resolvePoint(opts.station),
        resolvePoint(opts.premises),
      ]);
      const [stationSeries, premisesSeries] = await dailyHistory({
        points: [station, premises],
        start: opts.start,
        end: opts.end,
        peril: parsePeril(opts.peril) ?? "high_temp",
      });
      if (!stationSeries || !premisesSeries) {
        throw new Error("the archive returned no observations for those points");
      }
      const measurement = measureGeographicBasis({
        station: stationSeries,
        premises: premisesSeries,
        threshold: Number.parseFloat(opts.threshold),
        direction: opts.direction,
      });
      if (isJson()) {
        return emitJson({ station, premises, measurement, describe: describeGeoBasis(measurement) });
      }
      const unit = measurement.unit === "F" ? "°F" : "";
      process.stdout.write(`Station:            ${station.name ?? opts.station}\n`);
      process.stdout.write(`Premises:           ${premises.name ?? opts.premises}\n`);
      process.stdout.write(`Days compared:      ${measurement.days}\n\n`);
      process.stdout.write(`Correlation:        ${measurement.correlation.toFixed(3)}\n`);
      process.stdout.write(`Typical gap:        ${measurement.meanAbsDifference.toFixed(1)}${unit} (worst ${measurement.maxAbsDifference.toFixed(1)}${unit})\n`);
      process.stdout.write(`Trigger corr.:      ${measurement.triggerCorrelation.toFixed(3)}  <- measured, feed this to \`basis\`\n`);
      process.stdout.write(`Loss days:          ${measurement.lossDays}\n`);
      process.stdout.write(`Paid when fine:     ${measurement.falsePositiveDays} days\n\n`);
      process.stdout.write(`${describeGeoBasis(measurement)}\n`);
    },
  );

function parseMonths(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((part) => {
    const month = Number.parseInt(part.trim(), 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`--months takes calendar numbers 1-12, got "${part.trim()}"`);
    }
    return month;
  });
}

program
  .command("backtest <eventTicker>")
  .description("Replay a ladder's loss-region rungs against the seasons that already happened.")
  .requiredOption("--revenue <csv>", "path to a date,revenue CSV")
  .requiredOption("--premises <place>", "where the business is (name or lat,lon)")
  .option("--contracts <n>", "contracts per rung; omit to size each rung to its own loss")
  .option("--months <list>", "calendar months the business is exposed, e.g. 5,6,7,8,9")
  .option("--start <date>", "history start (YYYY-MM-DD)", "2022-01-01")
  .option("--end <date>", "history end (YYYY-MM-DD)", "2025-12-31")
  .action(
    async (
      eventTicker: string,
      opts: {
        revenue: string;
        premises: string;
        contracts?: string;
        months?: string;
        start: string;
        end: string;
      },
    ) => {
      const ladder = await kalshi.getLadder(eventTicker);
      if (!ladder.peril) throw new Error(`${eventTicker} has no classified peril to measure`);
      if (!ladder.settlement.station) {
        throw new Error(`${eventTicker} does not name a settlement station in its rules`);
      }
      const [station, premises] = await Promise.all([
        resolvePoint(ladder.settlement.station),
        resolvePoint(opts.premises),
      ]);

      // Fit the curve on the client's own history, then replay against both
      // locations: the premises decide the loss, the station decides the payout.
      const rows = parseRevenueCsv(await readFile(opts.revenue, "utf8"));
      const revenueDates = rows.map((r) => r.date).toSorted();
      const [fitSeries] = await dailyHistory({
        points: [premises],
        start: revenueDates[0] ?? opts.start,
        end: revenueDates.at(-1) ?? opts.end,
        peril: ladder.peril,
      });
      if (!fitSeries) throw new Error("no observations returned for the premises");
      const curve = fitLossCurve(alignSamples(rows, fitSeries), fitSeries.unit);

      const [stationSeries, premisesSeries] = await dailyHistory({
        points: [station, premises],
        start: opts.start,
        end: opts.end,
        peril: ladder.peril,
      });
      if (!stationSeries || !premisesSeries) {
        throw new Error("the archive returned no observations for those points");
      }

      const months = parseMonths(opts.months);
      const lossRungs = selectLossRungs(ladder, curve);
      const fixed = opts.contracts === undefined ? null : Number.parseFloat(opts.contracts);
      const legs: CoverLeg[] =
        fixed === null
          ? sizeLegsFromHistory({
              rungs: lossRungs,
              curve,
              station: stationSeries,
              premises: premisesSeries,
              ...(months.length > 0 && { months }),
            })
          : lossRungs
              .filter((rung) => rung.strike !== null && rung.quotes.yesAsk > 0)
              .map((rung) => ({
                label: rung.strike?.label ?? rung.id,
                strike: rung.strike as NonNullable<typeof rung.strike>,
                contracts: fixed,
                pricePerContract: rung.quotes.yesAsk,
              }));
      if (legs.length === 0) {
        throw new Error(
          `no rung on ${eventTicker} sits in the loss region (${curve.direction} ${curve.threshold}) with a live ask`,
        );
      }

      const result = backtest({
        legs,
        curve,
        station: stationSeries,
        premises: premisesSeries,
        ...(months.length > 0 && { months }),
      });
      if (isJson()) return emitJson({ curve, legs, result, describe: describeBacktest(result) });

      const unit = curve.unit === "F" ? "°F" : "";
      process.stdout.write(`Ladder:           ${ladder.title}\n`);
      process.stdout.write(`Settles at:       ${ladder.settlement.station}\n`);
      process.stdout.write(`Premises:         ${premises.name ?? opts.premises}\n\n`);
      process.stdout.write(`Fitted loss:      ${curve.direction} ${curve.threshold}${unit}, $${curve.slopePerUnit.toFixed(0)}/${unit || "unit"} (R² ${curve.rSquared.toFixed(2)})\n`);
      const sizing = fixed === null ? "sized to each rung's own loss" : `${fixed} contracts per rung`;
      process.stdout.write(`Cover bought:     ${legs.length} rungs, ${sizing}\n`);
      for (const leg of legs) {
        process.stdout.write(
          `  ${leg.label.padEnd(18)} ${String(leg.contracts).padStart(6)} contracts @ ${(leg.pricePerContract * 100).toFixed(0)}¢\n`,
        );
      }
      process.stdout.write(`\nReplayed:         ${result.days} days\n`);
      process.stdout.write(`Weather losses:   $${Math.round(result.totalLoss).toLocaleString()}\n`);
      process.stdout.write(`Cover paid:       $${Math.round(result.totalPayout).toLocaleString()} (${(result.coveredFraction * 100).toFixed(0)}% of losses)\n`);
      process.stdout.write(`Premium spent:    $${Math.round(result.totalPremium).toLocaleString()}\n`);
      process.stdout.write(`Loss ratio:       ${result.lossRatio === null ? "n/a" : result.lossRatio.toFixed(2)}\n\n`);
      process.stdout.write(`Daily swing:      $${Math.round(result.swingUnhedged).toLocaleString()} -> $${Math.round(result.swingHedged).toLocaleString()}  (${(result.swingReduction * 100).toFixed(0)}% smoother)\n`);
      process.stdout.write(`Worst day:        -$${Math.round(-result.worstDayUnhedged).toLocaleString()} -> -$${Math.round(-result.worstDayHedged).toLocaleString()}\n`);
      process.stdout.write(`Paid when hurt:   ${result.daysHurtAndPaid} of ${result.daysHurt} days (${(result.realizedTriggerCorrelation * 100).toFixed(0)}%)\n\n`);
      process.stdout.write(`${describeBacktest(result)}\n`);
      process.stdout.write(
        `\nPremium is charged at today's ask on every replayed day; real prices moved with the season.\n`,
      );
    },
  );

program
  .command("solve <eventTicker>")
  .description("Solve the cover a business's loss curve implies, priced as a premium.")
  .requiredOption("--revenue <csv>", "path to a date,revenue CSV")
  .requiredOption("--premises <place>", "where the business is (name or lat,lon)")
  .option("--months <list>", "calendar months the business is exposed, e.g. 5,6,7,8,9")
  .option("--start <date>", "history start (YYYY-MM-DD)", "2022-01-01")
  .option("--end <date>", "history end (YYYY-MM-DD)", "2025-12-31")
  .action(
    async (
      eventTicker: string,
      opts: {
        revenue: string;
        premises: string;
        months?: string;
        start: string;
        end: string;
      },
    ) => {
      const ladder = await kalshi.getLadder(eventTicker);
      if (!ladder.peril) throw new Error(`${eventTicker} has no classified peril to measure`);
      if (!ladder.settlement.station) {
        throw new Error(`${eventTicker} does not name a settlement station in its rules`);
      }
      const [station, premises] = await Promise.all([
        resolvePoint(ladder.settlement.station),
        resolvePoint(opts.premises),
      ]);
      const rows = parseRevenueCsv(await readFile(opts.revenue, "utf8"));
      const revenueDates = rows.map((r) => r.date).toSorted();
      const [fitSeries] = await dailyHistory({
        points: [premises],
        start: revenueDates[0] ?? opts.start,
        end: revenueDates.at(-1) ?? opts.end,
        peril: ladder.peril,
      });
      if (!fitSeries) throw new Error("no observations returned for the premises");
      const curve = fitLossCurve(alignSamples(rows, fitSeries), fitSeries.unit);

      const [stationSeries, premisesSeries] = await dailyHistory({
        points: [station, premises],
        start: opts.start,
        end: opts.end,
        peril: ladder.peril,
      });
      if (!stationSeries || !premisesSeries) {
        throw new Error("the archive returned no observations for those points");
      }
      const months = parseMonths(opts.months);
      const plan = solveCover({
        ladder,
        curve,
        station: stationSeries,
        premises: premisesSeries,
        ...(months.length > 0 && { months }),
      });
      if (isJson()) return emitJson({ curve, plan });

      const unit = curve.unit === "F" ? "°F" : "";
      process.stdout.write(`Cover for:        ${ladder.title}\n`);
      process.stdout.write(`Settles at:       ${ladder.settlement.station}\n`);
      process.stdout.write(`Premises:         ${premises.name ?? opts.premises}\n\n`);
      process.stdout.write(`Attaches:         ${plan.direction} ${plan.attachment}${unit}\n`);
      process.stdout.write(`Premium:          $${plan.premiumPerDayUsdc.toFixed(2)} per day of cover\n`);
      process.stdout.write(`Cover limit:      $${Math.round(plan.limitUsdc).toLocaleString()} on the worst bucket\n`);
      process.stdout.write(`Worst day seen:   -$${Math.round(plan.worstDayLossUsdc).toLocaleString()}, of which cover carries ${(plan.worstDayCovered * 100).toFixed(0)}%\n\n`);
      for (const leg of plan.legs) {
        process.stdout.write(
          `  ${leg.label.padEnd(18)} ${String(leg.contracts).padStart(6)} contracts @ ${(leg.pricePerContract * 100).toFixed(0)}¢\n`,
        );
      }

      // The point of the whole exercise: a flat net column across outcomes.
      const values = plan.legs
        .map((l) => l.strike.floor ?? (l.strike.cap ?? 0) - 2)
        .concat([plan.attachment + 5]);
      process.stdout.write(`\n  ${unit || "value"}   loss      payout     net\n`);
      for (const row of coverProfile(plan, curve, values.toSorted((a, b) => a - b))) {
        process.stdout.write(
          `  ${String(row.value).padStart(4)}  -$${Math.round(row.lossUsdc).toString().padStart(6)}  +$${Math.round(row.payoutUsdc).toString().padStart(6)}  $${Math.round(row.netUsdc).toString().padStart(7)}\n`,
        );
      }

      process.stdout.write(
        `\nReplayed on ${plan.replay.days} ${plan.outOfSample ? "held-out" : "in-sample"} days: ${(plan.replay.swingReduction * 100).toFixed(0)}% smoother, paid on ${plan.replay.daysHurtAndPaid} of ${plan.replay.daysHurt} days that hurt.\n`,
      );
      for (const warning of plan.warnings) process.stdout.write(`  ! ${warning}\n`);
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
      priceCover({
        pricePerContract: Number.parseFloat(opts.price),
        premiumUsdc: Number.parseFloat(opts.budget),
        ...(opts.exposure ? { exposureUsdc: Number.parseFloat(opts.exposure) } : {}),
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
