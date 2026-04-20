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

router.get("/holdings", async (_req, res): Promise<void> => {
  const holdings = await db.select().from(holdingsTable).orderBy(holdingsTable.createdAt);
  res.json(
    ListHoldingsResponse.parse(
      holdings.map((h) => ({
        ...h,
        quantity: parseFloat(String(h.quantity)),
        manualPrice: h.manualPrice != null ? parseFloat(String(h.manualPrice)) : null,
      }))
    )
  );
});

router.post("/holdings", async (req, res): Promise<void> => {
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
  });
});

router.put("/holdings/:id", async (req, res): Promise<void> => {
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
  }));
});

router.delete("/holdings/:id", async (req, res): Promise<void> => {
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
    const priceData = priceMap.get(sym);
    const manualUnitPrice = h.manualPrice != null ? parseFloat(String(h.manualPrice)) : null;
    const currentPrice = priceData?.price ?? manualUnitPrice;
    const currentValue = currentPrice != null ? qty * currentPrice : null;

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

export default router;
