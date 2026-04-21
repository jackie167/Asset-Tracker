export type HoldingForm = {
  type: string;
  symbol: string;
  quantity: number;
  manualPrice?: number | null;
};

export type HoldingItem = {
  id: number;
  type: string;
  symbol: string;
  quantity: number;
  currentPrice?: number | null;
  currentValue?: number | null;
  change?: number | null;
  changePercent?: number | null;
  manualPrice?: number | null;
};

export type SortOrder = "none" | "asc" | "desc";
export type TypeMode = "stock" | "gold" | "other";
export type SnapshotRange = "1m" | "3m" | "6m" | "1y";

export type ChartPoint = {
  date: string;
  totalValue: number;
  stockValue: number;
  goldValue: number;
  typeValues?: Record<string, number>;
};
