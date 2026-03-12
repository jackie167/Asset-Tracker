import { Router, type IRouter } from "express";
import {
  GetLatestPricesResponse,
  RefreshPricesResponse,
} from "@workspace/api-zod";
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

export default router;
