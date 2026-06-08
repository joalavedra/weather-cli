#!/usr/bin/env node
import { Command } from "commander";
import {
  computeBasisRisk,
  computeHedge,
  fetchCityMarkets,
  fetchWeatherMarkets,
  getMarket,
  listAvailableCities,
  quoteFromMarket,
} from "@weather/core";
import type {
  BasisAssessment,
  ClassifiedMarket,
  HedgeQuote,
} from "@weather/core";

const program = new Command();
program
  .name("weather")
  .description("Browse Polymarket weather markets and compute hedge quotes.")
  .option("--json", "output JSON instead of tables");

interface GlobalOpts {
  json?: boolean;
}

function isJson(): boolean {
  return Boolean((program.opts() as GlobalOpts).json);
}

function printMarkets(markets: ClassifiedMarket[]): void {
  if (isJson()) {
    process.stdout.write(`${JSON.stringify(markets, null, 2)}\n`);
    return;
  }
  if (markets.length === 0) {
    process.stdout.write("No markets found.\n");
    return;
  }
  for (const m of markets) {
    const liq = `$${Math.floor(m.liquidity).toLocaleString()}`;
    const tag = `[${m.category}${m.city ? ` / ${m.city}` : ""}]`;
    const yesPrice = m.outcomePrices[0];
    const priceStr =
      yesPrice !== undefined ? `YES ${(yesPrice * 100).toFixed(1)}¢` : "";
    process.stdout.write(`${tag} ${m.question}\n`);
    process.stdout.write(
      `  liquidity: ${liq}  ${priceStr}  ends: ${m.endDate?.slice(0, 10) ?? "?"}\n`,
    );
    process.stdout.write(`  ${m.url}\n\n`);
  }
}

function printQuote(quote: HedgeQuote): void {
  if (isJson()) {
    process.stdout.write(`${JSON.stringify(quote, null, 2)}\n`);
    return;
  }
  const lines = [
    `YES price:        ${(quote.yesPriceUsdc * 100).toFixed(1)}¢`,
    `Cost budget:      $${quote.costBudgetUsdc.toFixed(2)}`,
    `Shares:           ${quote.sharesAffordable.toFixed(2)}`,
    `Max payout:       $${quote.maxPayoutUsdc.toFixed(2)}`,
    `If YES (trigger): +$${quote.profitIfYesUsdc.toFixed(2)} (ROI ${quote.roiIfYesPct.toFixed(1)}%)`,
    `If NO  (no hit):  -$${quote.costBudgetUsdc.toFixed(2)} (ROI ${quote.roiIfNoPct.toFixed(1)}%)`,
  ];
  if (quote.exposureValueUsdc !== null && quote.coverageRatio !== null) {
    lines.push(
      `Exposure:         $${quote.exposureValueUsdc.toFixed(2)}`,
      `Coverage ratio:   ${(quote.coverageRatio * 100).toFixed(1)}% of exposure`,
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printBasis(basis: BasisAssessment): void {
  if (isJson()) {
    process.stdout.write(`${JSON.stringify(basis, null, 2)}\n`);
    return;
  }
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

program
  .command("list")
  .description("List active weather markets across all known categories.")
  .option("--limit <n>", "limit results", "20")
  .action(async (opts: { limit: string }) => {
    const markets = await fetchWeatherMarkets();
    const n = Number.parseInt(opts.limit, 10);
    printMarkets(markets.slice(0, n));
  });

program
  .command("city <name>")
  .description("List weather markets for a specific city (e.g. Tokyo).")
  .action(async (name: string) => {
    const markets = await fetchCityMarkets(name);
    printMarkets(markets);
  });

program
  .command("cities")
  .description("List cities with active weather markets.")
  .action(async () => {
    const markets = await fetchWeatherMarkets();
    const cities = listAvailableCities(markets);
    if (isJson()) {
      process.stdout.write(`${JSON.stringify(cities, null, 2)}\n`);
      return;
    }
    for (const c of cities) {
      process.stdout.write(
        `${c.city.padEnd(20)} ${String(c.count).padStart(3)} markets   $${Math.floor(c.totalLiquidity).toLocaleString()} liquidity\n`,
      );
    }
  });

program
  .command("show <idOrSlug>")
  .description("Show a single market in detail.")
  .action(async (idOrSlug: string) => {
    const market = await getMarket(idOrSlug);
    if (isJson()) {
      process.stdout.write(`${JSON.stringify(market, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${market.question}\n\n`);
    process.stdout.write(`Slug:       ${market.slug}\n`);
    process.stdout.write(`Liquidity:  $${Math.floor(market.liquidity).toLocaleString()}\n`);
    process.stdout.write(`Volume:     $${Math.floor(market.volume).toLocaleString()}\n`);
    process.stdout.write(`Ends:       ${market.endDate?.slice(0, 10) ?? "?"}\n`);
    for (let i = 0; i < market.outcomes.length; i++) {
      const o = market.outcomes[i];
      const p = market.outcomePrices[i];
      if (o === undefined || p === undefined) continue;
      process.stdout.write(`  ${o.padEnd(8)} ${(p * 100).toFixed(1)}¢\n`);
    }
    process.stdout.write(`\n${market.url}\n`);
    if (market.description) {
      process.stdout.write(`\n${market.description.slice(0, 400)}${market.description.length > 400 ? "…" : ""}\n`);
    }
  });

program
  .command("quote <idOrSlug>")
  .description("Compute a hedge quote for a market.")
  .requiredOption("--side <yesOrNo>", "outcome to buy (Yes or No)")
  .requiredOption("--budget <usdc>", "USDC you'd spend on the hedge")
  .option("--exposure <usdc>", "value at risk if the bad outcome happens")
  .action(
    async (
      idOrSlug: string,
      opts: { side: string; budget: string; exposure?: string },
    ) => {
      const market = await getMarket(idOrSlug);
      const side =
        opts.side.toLowerCase() === "yes"
          ? "Yes"
          : opts.side.toLowerCase() === "no"
            ? "No"
            : null;
      if (!side) throw new Error(`--side must be 'yes' or 'no', got ${opts.side}`);
      const budget = Number.parseFloat(opts.budget);
      const exposure = opts.exposure ? Number.parseFloat(opts.exposure) : undefined;
      const quote = quoteFromMarket(market, side, budget, exposure);
      if (!isJson()) process.stdout.write(`Hedge for: ${market.question}\n\n`);
      printQuote(quote);
    },
  );

program
  .command("basis <idOrSlug>")
  .description("Quote a market AND score its basis risk against your real loss.")
  .requiredOption("--side <yesOrNo>", "outcome to buy (Yes or No)")
  .requiredOption("--budget <usdc>", "USDC you'd spend on the hedge")
  .requiredOption("--exposure <usdc>", "dollars at risk if the loss happens")
  .requiredOption("--loss <text>", "your real loss in plain words")
  .requiredOption("--window-start <date>", "exposure window start (YYYY-MM-DD)")
  .requiredOption("--window-end <date>", "exposure window end (YYYY-MM-DD)")
  .requiredOption("--correlation <0to1>", "P(market pays | your loss happens)")
  .requiredOption("--rationale <text>", "why that correlation estimate holds")
  .action(
    async (
      idOrSlug: string,
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
      const market = await getMarket(idOrSlug);
      const side =
        opts.side.toLowerCase() === "yes"
          ? "Yes"
          : opts.side.toLowerCase() === "no"
            ? "No"
            : null;
      if (!side) throw new Error(`--side must be 'yes' or 'no', got ${opts.side}`);
      const exposure = Number.parseFloat(opts.exposure);
      const quote = quoteFromMarket(
        market,
        side,
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
      if (!isJson()) process.stdout.write(`Hedge for: ${market.question}\n\n`);
      printQuote(quote);
      if (!isJson()) process.stdout.write("\n");
      printBasis(basis);
    },
  );

program
  .command("hedge")
  .description("Manual hedge calc from raw inputs (useful for what-if).")
  .requiredOption("--yes-price <usdc>", "YES price 0.0-1.0")
  .requiredOption("--budget <usdc>", "USDC budget")
  .option("--exposure <usdc>", "value at risk")
  .action((opts: { yesPrice: string; budget: string; exposure?: string }) => {
    const args = {
      yesPriceUsdc: Number.parseFloat(opts.yesPrice),
      costBudgetUsdc: Number.parseFloat(opts.budget),
      ...(opts.exposure ? { exposureValueUsdc: Number.parseFloat(opts.exposure) } : {}),
    };
    printQuote(computeHedge(args));
  });

await program.parseAsync(process.argv);
