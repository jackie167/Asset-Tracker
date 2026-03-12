import { db, pricesTable, holdingsTable, snapshotsTable } from "@workspace/db";
import { desc, eq, and, gte, inArray } from "drizzle-orm";

interface PriceData {
  type: "stock" | "gold";
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
}

async function fetchStockPrice(symbol: string): Promise<PriceData | null> {
  try {
    const url = `https://iboard-query.ssi.com.vn/v2/stock/price?symbol=${symbol.toUpperCase()}`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: { lastPrice?: number; change?: number; changePercent?: number } };
    const data = json?.data;
    if (!data || data.lastPrice == null) return null;
    return {
      type: "stock",
      symbol: symbol.toUpperCase(),
      price: data.lastPrice * 1000,
      change: data.change != null ? data.change * 1000 : null,
      changePercent: data.changePercent != null ? data.changePercent : null,
    };
  } catch {
    return null;
  }
}

async function fetchGoldPrice(): Promise<PriceData[]> {
  try {
    const res = await fetch("https://sjc.com.vn/GoldPrice/Services/PriceService.ashx", {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { SJC?: { City?: string; Buy?: string; Sell?: string }[] };
    const items = json?.SJC || [];
    const hanoi = items.find((i) => i.City?.toLowerCase().includes("hà nội") || i.City?.toLowerCase().includes("ha noi") || i.City === "Hà Nội");
    const entry = hanoi || items[0];
    if (!entry || !entry.Buy) return [];

    const parseVND = (s: string) => {
      const n = parseFloat(s.replace(/[^0-9.]/g, ""));
      return isNaN(n) ? 0 : n * 1000;
    };

    const buyPrice = parseVND(entry.Buy);
    if (!buyPrice) return [];

    return [
      {
        type: "gold",
        symbol: "SJC_1L",
        price: buyPrice,
        change: null,
        changePercent: null,
      },
      {
        type: "gold",
        symbol: "SJC_1C",
        price: buyPrice / 10,
        change: null,
        changePercent: null,
      },
    ];
  } catch {
    return [];
  }
}

export async function fetchAndStorePrices(): Promise<{ updated: number; message: string }> {
  const holdings = await db.select().from(holdingsTable);
  if (!holdings.length) {
    return { updated: 0, message: "No holdings to update" };
  }

  const stockSymbols = [...new Set(holdings.filter(h => h.type === "stock").map(h => h.symbol.toUpperCase()))];
  const hasGold = holdings.some(h => h.type === "gold");

  const pricePromises: Promise<PriceData | null>[] = stockSymbols.map(fetchStockPrice);
  const [stockResults, goldResults] = await Promise.all([
    Promise.all(pricePromises),
    hasGold ? fetchGoldPrice() : Promise.resolve([] as PriceData[])
  ]);

  const prices: PriceData[] = [
    ...stockResults.filter((p): p is PriceData => p !== null),
    ...goldResults
  ];

  if (!prices.length) {
    return { updated: 0, message: "Could not fetch prices from sources" };
  }

  for (const p of prices) {
    await db.insert(pricesTable).values({
      type: p.type,
      symbol: p.symbol,
      price: String(p.price),
      change: p.change != null ? String(p.change) : null,
      changePercent: p.changePercent != null ? String(p.changePercent) : null,
      fetchedAt: new Date(),
    });
  }

  await savePortfolioSnapshot(holdings, prices);

  return { updated: prices.length, message: `Updated ${prices.length} price(s)` };
}

async function savePortfolioSnapshot(
  holdings: typeof holdingsTable.$inferSelect[],
  prices: PriceData[]
): Promise<void> {
  const priceMap = new Map<string, number>();
  for (const p of prices) {
    priceMap.set(p.symbol.toUpperCase(), p.price);
  }

  let stockValue = 0;
  let goldValue = 0;

  for (const h of holdings) {
    const qty = parseFloat(String(h.quantity));
    const sym = h.symbol.toUpperCase();
    const price = priceMap.get(sym);
    if (price == null) continue;
    const val = qty * price;
    if (h.type === "stock") stockValue += val;
    else goldValue += val;
  }

  const totalValue = stockValue + goldValue;
  if (totalValue > 0) {
    await db.insert(snapshotsTable).values({
      totalValue: String(totalValue),
      stockValue: String(stockValue),
      goldValue: String(goldValue),
      snapshotAt: new Date(),
    });
  }
}

export async function getLatestPrices(symbols?: string[]): Promise<typeof pricesTable.$inferSelect[]> {
  const allSymbols = symbols && symbols.length > 0 ? symbols : undefined;

  const subquery = await db
    .selectDistinct({ symbol: pricesTable.symbol, maxId: pricesTable.id })
    .from(pricesTable)
    .as("latest");

  const rows = await db
    .select()
    .from(pricesTable)
    .orderBy(desc(pricesTable.fetchedAt))
    .limit(1000);

  const seen = new Set<string>();
  const result: typeof pricesTable.$inferSelect[] = [];
  for (const row of rows) {
    if (!seen.has(row.symbol)) {
      seen.add(row.symbol);
      if (!allSymbols || allSymbols.includes(row.symbol)) {
        result.push(row);
      }
    }
  }
  return result;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startPriceScheduler(): void {
  if (schedulerInterval) return;

  console.log("[PriceFetcher] Starting price scheduler (every 15 minutes)");

  fetchAndStorePrices()
    .then((r) => console.log("[PriceFetcher] Initial fetch:", r.message))
    .catch((e) => console.error("[PriceFetcher] Initial fetch error:", e));

  schedulerInterval = setInterval(
    () => {
      fetchAndStorePrices()
        .then((r) => console.log("[PriceFetcher] Scheduled fetch:", r.message))
        .catch((e) => console.error("[PriceFetcher] Scheduled fetch error:", e));
    },
    15 * 60 * 1000
  );
}
