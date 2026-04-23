import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, transactionsTable } from "../../../lib/db/src/index.ts";

const router: IRouter = Router();

const CreateTransactionBody = z.object({
  side: z.enum(["buy", "sell"]),
  fundingSource: z.string().trim().min(1),
  assetType: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  totalValue: z.coerce.number().positive(),
  note: z.string().trim().optional().nullable(),
  executedAt: z.coerce.date().optional(),
});

function serializeTransaction(transaction: typeof transactionsTable.$inferSelect) {
  const quantity = parseFloat(String(transaction.quantity));
  const totalValue = parseFloat(String(transaction.totalValue));

  return {
    id: transaction.id,
    side: transaction.side,
    fundingSource: transaction.fundingSource,
    assetType: transaction.assetType,
    symbol: transaction.symbol,
    quantity,
    totalValue,
    unitPrice: transaction.unitPrice != null ? parseFloat(String(transaction.unitPrice)) : null,
    realizedInterest: transaction.realizedInterest != null ? parseFloat(String(transaction.realizedInterest)) : null,
    note: transaction.note,
    status: transaction.status,
    executedAt: transaction.executedAt,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

router.get("/transactions", async (_req, res): Promise<void> => {
  const transactions = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.executedAt));
  res.json(transactions.map(serializeTransaction));
});

router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const unitPrice = parsed.data.totalValue / parsed.data.quantity;
  const [transaction] = await db
    .insert(transactionsTable)
    .values({
      side: parsed.data.side,
      fundingSource: parsed.data.fundingSource.toUpperCase(),
      assetType: parsed.data.assetType.toLowerCase(),
      symbol: parsed.data.symbol.toUpperCase(),
      quantity: String(parsed.data.quantity),
      totalValue: String(parsed.data.totalValue),
      unitPrice: String(unitPrice),
      note: parsed.data.note || null,
      executedAt: parsed.data.executedAt ?? new Date(),
    })
    .returning();

  res.status(201).json(serializeTransaction(transaction));
});

export default router;
