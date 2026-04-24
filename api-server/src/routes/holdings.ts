import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, holdingsTable } from "../../../lib/db/src/index.ts";
import {
  ListHoldingsResponse,
  CreateHoldingBody,
  UpdateHoldingParams,
  UpdateHoldingBody,
  UpdateHoldingResponse,
  DeleteHoldingParams,
  GetPortfolioSummaryResponse,
} from "../../../lib/api-zod/src/index.ts";
import { getLatestPrices } from "../lib/priceFetcher.js";

const router: IRouter = Router();
const STOCK_RETURN_INITIAL_AT = new Date("2026-01-01T00:00:00.000Z");
const CASH_FIXED_ANNUAL_RATE = 0.06;

function usesManualPortfolioValue(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized !== "stock" && normalized !== "gold" && normalized !== "crypto";
}

function resolveHoldingCurrentValue(input: { type: string; quantity: number; currentPrice: number | null }): number | null {
  if (input.currentPrice == null) return null;
  return usesManualPortfolioValue(input.type) ? input.currentPrice : input.quantity * input.currentPrice;
}

function rejectManualPortfolioWrite(res: { status: (code: number) => { json: (body: unknown) => void } }): void {
  res.status(403).json({
    error: "Danh muc Tai san dang dong bo tu Investment sheet. Hay cap nhat Excel roi bam Sync.",
  });
}

function yearFraction(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (365 * 24 * 60 * 60 * 1000);
}

function calculateXirr(cashFlows: Array<{ date: Date; amount: number }>): number | null {
  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (!sorted.some((flow) => flow.amount < 0) || !sorted.some((flow) => flow.amount > 0)) {
    return null;
  }

  const startDate = sorted[0].date;
  const npv = (rate: number) =>
    sorted.reduce((sum, flow) => {
      const years = yearFraction(startDate, flow.date);
      return sum + flow.amount / Math.pow(1 + rate, years);
    }, 0);

  let low = -0.9999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);

  for (let i = 0; i < 20 && lowValue * highValue > 0; i += 1) {
    high *= 2;
    highValue = npv(high);
  }

  if (lowValue * highValue > 0) return null;

  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (Math.abs(midValue) < 0.0001) return mid;
    if (lowValue * midValue <= 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }

  return (low + high) / 2;
}

function deriveCashPrincipalFromCurrentValue(currentValue: number, asOf: Date): number | null {
  const years = yearFraction(STOCK_RETURN_INITIAL_AT, asOf);
  if (!(years > 0) || !(currentValue > 0)) return currentValue > 0 ? currentValue : null;
  return currentValue / Math.pow(1 + CASH_FIXED_ANNUAL_RATE, years);
}

function latestPriceMap(latestPrices: Awaited<ReturnType<typeof getLatestPrices>>) {
  const priceMap = new Map<string, number>();
  for (const price of latestPrices) {
    priceMap.set(price.symbol.toUpperCase(), parseFloat(String(price.price)));
  }
  return priceMap;
}

router.get("/holdings", async (_req, res): Promise<void> => {
  const holdings = await db.select().from(holdingsTable).orderBy(holdingsTable.createdAt);
  res.json(
    ListHoldingsResponse.parse(
      holdings.map((h) => ({
        ...h,
        quantity: parseFloat(String(h.quantity)),
        manualPrice: h.manualPrice != null ? parseFloat(String(h.manualPrice)) : null,
        costOfCapital: h.costOfCapital != null ? parseFloat(String(h.costOfCapital)) : null,
        interest: h.interest != null ? parseFloat(String(h.interest)) : null,
      }))
    )
  );
});

router.post("/holdings", async (req, res): Promise<void> => {
  rejectManualPortfolioWrite(res);
  return;

  const parsed = CreateHoldingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [holding] = await db
    .insert(holdingsTable)
    .values({
      type: parsed.data.type,
      symbol: parsed.data.symbol.toUpperCase(),
      quantity: String(parsed.data.quantity),
      manualPrice: parsed.data.manualPrice != null ? String(parsed.data.manualPrice) : null,
    })
    .returning();

  res.status(201).json({
    ...holding,
    quantity: parseFloat(String(holding.quantity)),
    manualPrice: holding.manualPrice != null ? parseFloat(String(holding.manualPrice)) : null,
    costOfCapital: holding.costOfCapital != null ? parseFloat(String(holding.costOfCapital)) : null,
    interest: holding.interest != null ? parseFloat(String(holding.interest)) : null,
  });
});

router.put("/holdings/:id", async (req, res): Promise<void> => {
  rejectManualPortfolioWrite(res);
  return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateHoldingParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateHoldingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [holding] = await db
    .update(holdingsTable)
    .set({
      type: parsed.data.type,
      quantity: String(parsed.data.quantity),
      manualPrice: parsed.data.manualPrice != null ? String(parsed.data.manualPrice) : null,
      updatedAt: new Date(),
    })
    .where(eq(holdingsTable.id, params.data.id))
    .returning();

  if (!holding) {
    res.status(404).json({ error: "Holding not found" });
    return;
  }

  res.json(UpdateHoldingResponse.parse({
    ...holding,
    quantity: parseFloat(String(holding.quantity)),
    manualPrice: holding.manualPrice != null ? parseFloat(String(holding.manualPrice)) : null,
    costOfCapital: holding.costOfCapital != null ? parseFloat(String(holding.costOfCapital)) : null,
    interest: holding.interest != null ? parseFloat(String(holding.interest)) : null,
  }));
});

router.delete("/holdings/:id", async (req, res): Promise<void> => {
  rejectManualPortfolioWrite(res);
  return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteHoldingParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(holdingsTable)
    .where(eq(holdingsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Holding not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/portfolio/summary", async (_req, res): Promise<void> => {
  const [holdings, latestPrices] = await Promise.all([
    db.select().from(holdingsTable).orderBy(holdingsTable.createdAt),
    getLatestPrices(),
  ]);

  const priceMap = new Map<string, { price: number; change: number | null; changePercent: number | null }>();
  for (const p of latestPrices) {
    priceMap.set(p.symbol.toUpperCase(), {
      price: parseFloat(String(p.price)),
      change: p.change != null ? parseFloat(String(p.change)) : null,
      changePercent: p.changePercent != null ? parseFloat(String(p.changePercent)) : null,
    });
  }
  const goldBenchmark = latestPrices.find((price) => price.type === "gold");

  let stockValue = 0;
  let goldValue = 0;
  let otherValue = 0;
  let lastUpdatedDate: Date | null = null;

  if (latestPrices.length > 0) {
    lastUpdatedDate = latestPrices.reduce((max, p) =>
      p.fetchedAt > max ? p.fetchedAt : max, latestPrices[0].fetchedAt
    );
  }

  const holdingsWithValue = holdings.map((h) => {
    const qty = parseFloat(String(h.quantity));
    const sym = h.symbol.toUpperCase();
    const priceData = priceMap.get(sym) ?? (h.type === "gold" && goldBenchmark
      ? {
          price: parseFloat(String(goldBenchmark.price)),
          change: goldBenchmark.change != null ? parseFloat(String(goldBenchmark.change)) : null,
          changePercent: goldBenchmark.changePercent != null ? parseFloat(String(goldBenchmark.changePercent)) : null,
        }
      : undefined);
    const manualUnitPrice = h.manualPrice != null ? parseFloat(String(h.manualPrice)) : null;
    const currentPrice = priceData?.price ?? manualUnitPrice;
    const currentValue = resolveHoldingCurrentValue({ type: h.type, quantity: qty, currentPrice });

    if (currentValue != null) {
      if (h.type === "stock") stockValue += currentValue;
      else if (h.type === "gold") goldValue += currentValue;
      else otherValue += currentValue;
    }

    return {
      id: h.id,
      type: h.type,
      symbol: h.symbol,
      quantity: qty,
      currentPrice,
      currentValue,
      change: priceData?.change ?? null,
      changePercent: priceData?.changePercent ?? null,
      manualPrice: manualUnitPrice,
      costOfCapital: h.costOfCapital != null ? parseFloat(String(h.costOfCapital)) : null,
      interest: h.interest != null ? parseFloat(String(h.interest)) : null,
    };
  });

  res.json(
    GetPortfolioSummaryResponse.parse({
      totalValue: stockValue + goldValue + otherValue,
      stockValue,
      goldValue,
      lastUpdated: lastUpdatedDate,
      holdings: holdingsWithValue,
    })
  );
});

router.get("/portfolio/returns/stock/:symbol", async (req, res): Promise<void> => {
  const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: "Missing stock symbol" });
    return;
  }

  const [holding] = await db
    .select()
    .from(holdingsTable)
    .where(eq(holdingsTable.symbol, symbol))
    .limit(1);

  if (!holding || holding.type !== "stock") {
    res.status(404).json({ error: `Stock ${symbol} not found` });
    return;
  }

  const qty = parseFloat(String(holding.quantity));
  const costOfCapital = holding.costOfCapital != null ? parseFloat(String(holding.costOfCapital)) : null;
  if (costOfCapital == null || costOfCapital <= 0) {
    res.status(400).json({ error: `Stock ${symbol} does not have cost of capital` });
    return;
  }

  const prices = await getLatestPrices();
  const priceMap = latestPriceMap(prices);
  const currentPrice = priceMap.get(symbol) ?? (holding.manualPrice != null ? parseFloat(String(holding.manualPrice)) : null);
  if (currentPrice == null) {
    res.status(400).json({ error: `Stock ${symbol} does not have a current price` });
    return;
  }

  const currentValue = qty * currentPrice;
  const today = new Date();
  const cashFlows = [
    { date: STOCK_RETURN_INITIAL_AT, amount: -costOfCapital },
    { date: today, amount: currentValue },
  ];
  const xirrAnnual = calculateXirr(cashFlows);
  const xirrMonthly = xirrAnnual == null ? null : Math.pow(1 + xirrAnnual, 1 / 12) - 1;

  res.json({
    symbol,
    mode: "basic_current_value_estimate",
    initialAt: STOCK_RETURN_INITIAL_AT,
    asOf: today,
    quantity: qty,
    costOfCapital,
    currentPrice,
    currentValue,
    unrealizedPnL: currentValue - costOfCapital,
    unrealizedPnLPercent: costOfCapital > 0 ? (currentValue - costOfCapital) / costOfCapital : null,
    xirrAnnual,
    xirrMonthly,
    cashFlows,
  });
});

router.get("/portfolio/returns", async (_req, res): Promise<void> => {
  const [holdings, prices] = await Promise.all([
    db.select().from(holdingsTable).orderBy(holdingsTable.createdAt),
    getLatestPrices(),
  ]);
  const priceMap = latestPriceMap(prices);
  const goldBenchmark = prices.find((price) => price.type === "gold");
  const goldPrice = goldBenchmark ? parseFloat(String(goldBenchmark.price)) : null;
  const today = new Date();

  const rows = holdings.map((holding) => {
    const symbol = holding.symbol.toUpperCase();
    const quantity = parseFloat(String(holding.quantity));
    const storedCostOfCapital = holding.costOfCapital != null ? parseFloat(String(holding.costOfCapital)) : null;
    const manualPrice = holding.manualPrice != null ? parseFloat(String(holding.manualPrice)) : null;
    const currentPrice = priceMap.get(symbol) ?? (holding.type === "gold" ? goldPrice : null) ?? manualPrice;
    const currentValue = resolveHoldingCurrentValue({ type: holding.type, quantity, currentPrice });
    const costOfCapital =
      holding.type === "cash" && currentValue != null
        ? deriveCashPrincipalFromCurrentValue(currentValue, today)
        : storedCostOfCapital;
    const unrealizedPnL =
      costOfCapital != null && currentValue != null ? currentValue - costOfCapital : null;
    const unrealizedPnLPercent =
      costOfCapital != null && costOfCapital > 0 && unrealizedPnL != null
        ? unrealizedPnL / costOfCapital
        : null;

    const xirrAnnual =
      holding.type === "cash" && currentValue != null && currentValue > 0
        ? CASH_FIXED_ANNUAL_RATE
        : costOfCapital != null && costOfCapital > 0 && currentValue != null
          ? calculateXirr([
              { date: STOCK_RETURN_INITIAL_AT, amount: -costOfCapital },
              { date: today, amount: currentValue },
            ])
          : null;
    const xirrMonthly = xirrAnnual == null ? null : Math.pow(1 + xirrAnnual, 1 / 12) - 1;

    return {
      symbol,
      type: holding.type,
      initialAt: STOCK_RETURN_INITIAL_AT,
      asOf: today,
      quantity,
      costOfCapital,
      currentPrice,
      currentValue,
      unrealizedPnL,
      unrealizedPnLPercent,
      xirrAnnual,
      xirrMonthly,
    };
  });

  res.json(rows);
});

export default router;
