import { Router, type IRouter } from "express";
import { and, desc, eq, lte, gte } from "drizzle-orm";
import {
  GetLatestPricesResponse,
  RefreshPricesResponse,
} from "../../../lib/api-zod/src/index.ts";
import { db, priceHistoryTable } from "../../../lib/db/src/index.ts";
import { fetchAndStorePrices, getLatestPrices } from "../lib/priceFetcher.js";

const router: IRouter = Router();

router.get("/prices/latest", async (_req, res): Promise<void> => {
  const prices = await getLatestPrices();
  res.json(
    GetLatestPricesResponse.parse(
      prices.map((p) => ({
        ...p,
        price: parseFloat(String(p.price)),
        change: p.change != null ? parseFloat(String(p.change)) : null,
        changePercent: p.changePercent != null ? parseFloat(String(p.changePercent)) : null,
      }))
    )
  );
});

router.post("/prices/refresh", async (_req, res): Promise<void> => {
  const result = await fetchAndStorePrices();
  res.json(
    RefreshPricesResponse.parse({
      success: result.updated > 0,
      updated: result.updated,
      message: result.message,
    })
  );
});

router.get("/prices/history", async (req, res): Promise<void> => {
  const symbol = typeof req.query["symbol"] === "string" ? req.query["symbol"].trim().toUpperCase() : "";
  const source = typeof req.query["source"] === "string" ? req.query["source"].trim() : "";
  const from = typeof req.query["from"] === "string" ? new Date(req.query["from"]) : null;
  const to = typeof req.query["to"] === "string" ? new Date(req.query["to"]) : null;
  const limitRaw = Number(req.query["limit"] ?? 500);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 5000) : 500;

  const filters = [
    symbol ? eq(priceHistoryTable.assetCode, symbol) : undefined,
    source ? eq(priceHistoryTable.source, source) : undefined,
    from && !Number.isNaN(from.getTime()) ? gte(priceHistoryTable.priceAt, from) : undefined,
    to && !Number.isNaN(to.getTime()) ? lte(priceHistoryTable.priceAt, to) : undefined,
  ].filter((filter): filter is NonNullable<typeof filter> => filter != null);

  const rows = await db
    .select()
    .from(priceHistoryTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(priceHistoryTable.priceAt))
    .limit(limit);

  res.json(rows.map((row) => ({
    id: row.id,
    date: row.priceAt,
    assetCode: row.assetCode,
    assetType: row.assetType,
    priceOrValue: parseFloat(String(row.priceOrValue)),
    quantity: row.quantity != null ? parseFloat(String(row.quantity)) : null,
    currentValue: row.currentValue != null ? parseFloat(String(row.currentValue)) : null,
    source: row.source,
    note: row.note,
    updatedAt: row.updatedAt,
  })));
});

export default router;
