export type VenueId = "kalshi" | "polymarket";

/**
 * The physical driver a contract settles on. This is a dimension a hedge can
 * mismatch the client's real loss on, so it is modelled explicitly rather than
 * re-inferred from the market title at every call site.
 */
export type Peril =
  | "high_temp"
  | "low_temp"
  | "rain"
  | "snow"
  | "hurricane"
  | "tornado"
  | "wind"
  | "other";

export type StrikeType = "less" | "greater" | "between" | "unknown";

/** Unit a strike is denominated in, when it can be determined. */
export type StrikeUnit = "F" | "in" | "count" | null;

/**
 * The bucket of outcomes a contract pays YES on. `floor` and `cap` are
 * inclusive bounds in `unit`; a null bound is unbounded on that side.
 */
export interface Strike {
  type: StrikeType;
  floor: number | null;
  cap: number | null;
  unit: StrikeUnit;
  /** The venue's own bucket label, e.g. "79° or below". */
  label: string;
}

export interface SettlementSource {
  name: string;
  url: string | null;
}

/**
 * Where the number that settles the contract comes from. Surfacing this is a
 * trust requirement rather than a nicety: a hedge is only as good as its
 * observation point, and a sensor the client cannot identify is a sensor they
 * cannot reason about.
 */
export interface Settlement {
  sources: SettlementSource[];
  /** Observation station named in the contract rules, when identifiable. */
  station: string | null;
  /** Verbatim primary resolution rule. */
  rules: string | null;
}

/** Venue-specific identifiers needed to place an order. */
export type Execution =
  | {
      venue: "polymarket";
      clobTokenIds: string[];
      conditionId: string | null;
      negRisk: boolean;
    }
  | {
      venue: "kalshi";
      ticker: string;
      eventTicker: string;
      seriesTicker: string;
    };

/** Best bid and ask on both sides, in dollars per contract. */
export interface Quotes {
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
}

export interface Market {
  venue: VenueId;
  id: string;
  slug: string;
  question: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  liquidity: number;
  volume: number;
  volume24h: number;
  openInterest: number;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  /**
   * Minimum order size in USDC. 0 means the venue sets no fixed dollar floor —
   * on Kalshi the minimum is one contract, which costs that side's ask.
   */
  orderMinSize: number;
  outcomes: string[];
  /** Ask per outcome, aligned to `outcomes` — what a buyer actually pays. */
  outcomePrices: number[];
  quotes: Quotes;
  peril: Peril | null;
  /** The place the contract settles on, as named by the venue's series. */
  location: string | null;
  strike: Strike | null;
  settlement: Settlement;
  execution: Execution;
  url: string;
}

/**
 * A family of contracts sharing a peril, location and settlement source —
 * Kalshi's "series" (e.g. KXHIGHNY, the daily NYC high temperature).
 */
export interface WeatherSeries {
  venue: VenueId;
  ticker: string;
  title: string;
  peril: Peril;
  location: string | null;
  /** How often a new event opens: daily, hourly, monthly, annual, custom. */
  frequency: string;
  settlementSources: SettlementSource[];
  tags: string[];
}

/**
 * One event's full strike ladder — every bucket of the same underlying on the
 * same date. The ladder is what makes parametric cover possible: a single
 * binary is a bet, a ladder can be shaped to match a loss curve.
 */
export interface Ladder {
  venue: VenueId;
  seriesTicker: string;
  eventTicker: string;
  title: string;
  peril: Peril | null;
  location: string | null;
  /** The date the underlying is measured on, ISO. */
  occurrenceDate: string | null;
  closeTime: string | null;
  settlement: Settlement;
  /** Rungs sorted ascending by strike floor. */
  rungs: Market[];
}

export interface HedgeQuote {
  yesPriceUsdc: number;
  costBudgetUsdc: number;
  sharesAffordable: number;
  maxPayoutUsdc: number;
  profitIfYesUsdc: number;
  roiIfYesPct: number;
  roiIfNoPct: number;
  exposureValueUsdc: number | null;
  coverageRatio: number | null;
}
