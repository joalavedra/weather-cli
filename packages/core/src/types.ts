export type WeatherCategory =
  | "temperature"
  | "hurricane"
  | "tornado"
  | "storm"
  | "space_weather"
  | "climate"
  | "other";

export interface Market {
  id: string;
  slug: string;
  question: string;
  description: string | null;
  endDate: string | null;
  startDate: string | null;
  liquidity: number;
  volume: number;
  active: boolean;
  closed: boolean;
  outcomes: string[];
  outcomePrices: number[];
  conditionId: string | null;
  clobTokenIds: string[];
  acceptingOrders: boolean;
  orderMinSize: number;
  negRisk: boolean;
  image: string | null;
  url: string;
}

export interface ClassifiedMarket extends Market {
  category: WeatherCategory;
  city: string | null;
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
