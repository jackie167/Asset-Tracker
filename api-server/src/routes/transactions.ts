import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, holdingsTable, transactionsTable } from "../../../lib/db/src/index.ts";

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
const UpdateTransactionParams = z.object({
  id: z.coerce.number().int().positive(),
});
const UpdateTransactionBody = CreateTransactionBody.omit({ executedAt: true });

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

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getHoldingBySymbol(tx: any, symbol: string) {
  const [holding] = await tx
    .select()
    .from(holdingsTable)
    .where(eq(holdingsTable.symbol, symbol.toUpperCase()))
    .limit(1);
  return holding as typeof holdingsTable.$inferSelect | undefined;
}

async function adjustCash(tx: any, delta: number) {
  const cash = await getHoldingBySymbol(tx, "CASH");
  if (!cash) {
    await tx.insert(holdingsTable).values({
      type: "cash",
      symbol: "CASH",
      quantity: "1",
      manualPrice: String(delta),
      costOfCapital: String(delta),
    });
    return;
  }

  const currentValue = toNumber(cash.quantity) * toNumber(cash.manualPrice);
  const nextValue = currentValue + delta;
  await tx
    .update(holdingsTable)
    .set({
      quantity: "1",
      manualPrice: String(nextValue),
      costOfCapital: String(nextValue),
      updatedAt: new Date(),
    })
    .where(eq(holdingsTable.id, cash.id));
}

async function increaseAsset(tx: any, input: { symbol: string; assetType: string; quantity: number; costIncrease: number; interestDelta?: number }) {
  const holding = await getHoldingBySymbol(tx, input.symbol);
  if (!holding) {
    await tx.insert(holdingsTable).values({
      type: input.assetType,
      symbol: input.symbol.toUpperCase(),
      quantity: String(input.quantity),
      manualPrice: null,
      costOfCapital: String(input.costIncrease),
      interest: input.interestDelta ? String(input.interestDelta) : null,
    });
    return;
  }

  await tx
    .update(holdingsTable)
    .set({
      type: input.assetType,
      quantity: String(toNumber(holding.quantity) + input.quantity),
      costOfCapital: String(toNumber(holding.costOfCapital) + input.costIncrease),
      interest: String(toNumber(holding.interest) + (input.interestDelta ?? 0)),
      updatedAt: new Date(),
    })
    .where(eq(holdingsTable.id, holding.id));
}

async function decreaseAsset(tx: any, input: { symbol: string; quantity: number; costDecrease: number; interestDelta?: number }) {
  const holding = await getHoldingBySymbol(tx, input.symbol);
  if (!holding) throw new Error(`Asset ${input.symbol} not found`);

  const currentQuantity = toNumber(holding.quantity);
  if (currentQuantity + 1e-9 < input.quantity) {
    throw new Error(`Not enough quantity for ${input.symbol}`);
  }

  const nextQuantity = Math.max(0, currentQuantity - input.quantity);
  const nextCost = Math.max(0, toNumber(holding.costOfCapital) - input.costDecrease);

  await tx
    .update(holdingsTable)
    .set({
      quantity: String(nextQuantity),
      costOfCapital: String(nextQuantity === 0 ? 0 : nextCost),
      interest: String(toNumber(holding.interest) + (input.interestDelta ?? 0)),
      updatedAt: new Date(),
    })
    .where(eq(holdingsTable.id, holding.id));
}

async function applyTransactionEffect(tx: any, input: {
  side: "buy" | "sell";
  assetType: string;
  symbol: string;
  quantity: number;
  totalValue: number;
}) {
  if (input.side === "buy") {
    await increaseAsset(tx, {
      symbol: input.symbol,
      assetType: input.assetType,
      quantity: input.quantity,
      costIncrease: input.totalValue,
    });
    await adjustCash(tx, -input.totalValue);
    return 0;
  }

  const holding = await getHoldingBySymbol(tx, input.symbol);
  if (!holding) throw new Error(`Asset ${input.symbol} not found`);
  const currentQuantity = toNumber(holding.quantity);
  if (currentQuantity + 1e-9 < input.quantity) {
    throw new Error(`Not enough quantity for ${input.symbol}`);
  }

  const averageCost = currentQuantity > 0 ? toNumber(holding.costOfCapital) / currentQuantity : 0;
  const costDecrease = averageCost * input.quantity;
  const realizedInterest = input.totalValue - costDecrease;

  await decreaseAsset(tx, {
    symbol: input.symbol,
    quantity: input.quantity,
    costDecrease,
    interestDelta: realizedInterest,
  });
  await adjustCash(tx, input.totalValue);
  return realizedInterest;
}

async function reverseTransactionEffect(tx: any, transaction: typeof transactionsTable.$inferSelect) {
  if (transaction.status !== "applied") return;

  const quantity = toNumber(transaction.quantity);
  const totalValue = toNumber(transaction.totalValue);
  const realizedInterest = toNumber(transaction.realizedInterest);

  if (transaction.side === "buy") {
    await decreaseAsset(tx, {
      symbol: transaction.symbol,
      quantity,
      costDecrease: totalValue,
    });
    await adjustCash(tx, totalValue);
    return;
  }

  await increaseAsset(tx, {
    symbol: transaction.symbol,
    assetType: transaction.assetType,
    quantity,
    costIncrease: totalValue - realizedInterest,
    interestDelta: -realizedInterest,
  });
  await adjustCash(tx, -totalValue);
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

  try {
    const transaction = await db.transaction(async (tx) => {
      const assetType = parsed.data.assetType.toLowerCase();
      const symbol = parsed.data.symbol.toUpperCase();
      const unitPrice = parsed.data.totalValue / parsed.data.quantity;
      const realizedInterest = await applyTransactionEffect(tx, {
        side: parsed.data.side,
        assetType,
        symbol,
        quantity: parsed.data.quantity,
        totalValue: parsed.data.totalValue,
      });

      const [created] = await tx
        .insert(transactionsTable)
        .values({
          side: parsed.data.side,
          fundingSource: "CASH",
          assetType,
          symbol,
          quantity: String(parsed.data.quantity),
          totalValue: String(parsed.data.totalValue),
          unitPrice: String(unitPrice),
          realizedInterest: String(realizedInterest),
          note: parsed.data.note || null,
          status: "applied",
          executedAt: parsed.data.executedAt ?? new Date(),
        })
        .returning();
      return created;
    });

    res.status(201).json(serializeTransaction(transaction));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to apply transaction" });
  }
});

router.put("/transactions/:id", async (req, res): Promise<void> => {
  const params = UpdateTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const transaction = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.id, params.data.id))
        .limit(1);

      if (!existing) return null;

      await reverseTransactionEffect(tx, existing);

      const assetType = parsed.data.assetType.toLowerCase();
      const symbol = parsed.data.symbol.toUpperCase();
      const unitPrice = parsed.data.totalValue / parsed.data.quantity;
      const realizedInterest = await applyTransactionEffect(tx, {
        side: parsed.data.side,
        assetType,
        symbol,
        quantity: parsed.data.quantity,
        totalValue: parsed.data.totalValue,
      });

      const [updated] = await tx
        .update(transactionsTable)
        .set({
          side: parsed.data.side,
          fundingSource: "CASH",
          assetType,
          symbol,
          quantity: String(parsed.data.quantity),
          totalValue: String(parsed.data.totalValue),
          unitPrice: String(unitPrice),
          realizedInterest: String(realizedInterest),
          note: parsed.data.note || null,
          status: "applied",
          updatedAt: new Date(),
        })
        .where(eq(transactionsTable.id, params.data.id))
        .returning();
      return updated;
    });

    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    res.json(serializeTransaction(transaction));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update transaction" });
  }
});

router.delete("/transactions/:id", async (req, res): Promise<void> => {
  const params = UpdateTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const deleted = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.id, params.data.id))
        .limit(1);

      if (!existing) return null;

      await reverseTransactionEffect(tx, existing);
      const [removed] = await tx
        .delete(transactionsTable)
        .where(eq(transactionsTable.id, params.data.id))
        .returning();
      return removed;
    });

    if (!deleted) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to delete transaction" });
  }
});

export default router;
