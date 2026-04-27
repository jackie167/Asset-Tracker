import { Router, type IRouter } from "express";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, holdingsTable, portfolioCashFlowsTable, transactionsTable } from "../../../lib/db/src/index.ts";
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

function normalizeHoldingType(type: string): string {
  return type.trim().toLowerCase();
}

function usesManualPortfolioValue(type: string): boolean {
  const normalized = normalizeHoldingType(type);
  return normalized !== "stock" && normalized !== "gold" && normalized !== "crypto";
}

function resolveHoldingCurrentValue(input: { type: string; quantity: number; currentPrice: number | null }): number | null {
  if (input.currentPrice == null) return null;
  return usesManualPortfolioValue(input.type) ? input.currentPrice : input.quantity * input.currentPrice;
}

function buildHoldingPnLFields(input: {
  type: string;
  quantity: number;
  costOfCapital: number | null;
  interest: number | null;
  currentValue: number | null;
}) {
  const quantityRemaining = input.quantity;
  const costBasisRemaining = input.costOfCapital;
  const realizedPnl = input.interest ?? 0;
  const avgCost =
    costBasisRemaining != null && quantityRemaining > 0 && !usesManualPortfolioValue(input.type)
      ? costBasisRemaining / quantityRemaining
      : costBasisRemaining;
  const unrealizedPnl =
    input.currentValue != null && costBasisRemaining != null
      ? input.currentValue - costBasisRemaining
      : null;
  const totalPnl = unrealizedPnl != null ? unrealizedPnl + realizedPnl : null;

  return {
    quantityRemaining,
    avgCost,
    costBasisRemaining,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
  };
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
  const merged = new Map<number, number>();
  for (const flow of cashFlows) {
    const time = flow.date.getTime();
    if (!Number.isFinite(time) || !Number.isFinite(flow.amount) || Math.abs(flow.amount) < 1e-9) continue;
    merged.set(time, (merged.get(time) ?? 0) + flow.amount);
  }

  const sorted = [...merged.entries()]
    .map(([time, amount]) => ({ date: new Date(time), amount }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!sorted.some((flow) => flow.amount < 0) || !sorted.some((flow) => flow.amount > 0)) {
    return null;
  }

  const startDate = sorted[0].date;
  const npv = (rate: number) => {
    if (rate <= -0.999999999) return Number.NaN;
    return sorted.reduce((sum, flow) => {
      const years = yearFraction(startDate, flow.date);
      return sum + flow.amount / Math.pow(1 + rate, years);
    }, 0);
  };
  const dNpv = (rate: number) => {
    if (rate <= -0.999999999) return Number.NaN;
    return sorted.reduce((sum, flow) => {
      const years = yearFraction(startDate, flow.date);
      if (years === 0) return sum;
      return sum - (years * flow.amount) / Math.pow(1 + rate, years + 1);
    }, 0);
  };

  const guesses = [-0.9, -0.5, -0.2, -0.05, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
  for (const guess of guesses) {
    let rate = guess;
    for (let i = 0; i < 100; i += 1) {
      const value = npv(rate);
      if (!Number.isFinite(value)) break;
      if (Math.abs(value) < 0.0001) return rate;
      const derivative = dNpv(rate);
      if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-10) break;
      const next = rate - value / derivative;
      if (!Number.isFinite(next) || next <= -0.999999999) break;
      if (Math.abs(next - rate) < 1e-10) return next;
      rate = next;
    }
  }

  const brackets = [
    [-0.9999, -0.9],
    [-0.9, -0.5],
    [-0.5, -0.2],
    [-0.2, -0.05],
    [-0.05, 0.05],
    [0.05, 0.2],
    [0.2, 0.5],
    [0.5, 1],
    [1, 2],
    [2, 5],
    [5, 10],
    [10, 50],
    [50, 200],
  ] as const;

  for (const [lowStart, highStart] of brackets) {
    let low = lowStart;
    let high = highStart;
    let lowValue = npv(low);
    const highValue = npv(high);
    if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) continue;

    for (let i = 0; i < 120; i += 1) {
      const mid = (low + high) / 2;
      const midValue = npv(mid);
      if (!Number.isFinite(midValue)) break;
      if (Math.abs(midValue) < 0.0001) return mid;
      if (lowValue * midValue <= 0) {
        high = mid;
      } else {
        low = mid;
        lowValue = midValue;
      }
    }

    return (low + high) / 2;
  }

  return null;
}

function latestPriceMap(latestPrices: Awaited<ReturnType<typeof getLatestPrices>>) {
  const priceMap = new Map<string, number>();
  for (const price of latestPrices) {
    priceMap.set(price.symbol.toUpperCase(), parseFloat(String(price.price)));
  }
  return priceMap;
}

async function getPortfolioCurrentValueSnapshot() {
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
  const goldBenchmark = latestPrices.find((price) => normalizeHoldingType(price.type) === "gold");

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
    const normalizedType = normalizeHoldingType(h.type);
    const priceData = priceMap.get(sym) ?? (normalizedType === "gold" && goldBenchmark
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
      if (normalizedType === "stock") stockValue += currentValue;
      else if (normalizedType === "gold") goldValue += currentValue;
      else otherValue += currentValue;
    }

    const costOfCapital = h.costOfCapital != null ? parseFloat(String(h.costOfCapital)) : null;
    const interest = h.interest != null ? parseFloat(String(h.interest)) : null;

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
      costOfCapital,
      interest,
      ...buildHoldingPnLFields({
        type: h.type,
        quantity: qty,
        costOfCapital,
        interest,
        currentValue,
      }),
    };
  });

  return {
    totalValue: stockValue + goldValue + otherValue,
    stockValue,
    goldValue,
    lastUpdatedDate,
    holdingsWithValue,
  };
}

async function buildPortfolioXirrSnapshot() {
  const [portfolioSnapshot, externalCashFlows, buyTransactions] = await Promise.all([
    getPortfolioCurrentValueSnapshot(),
    db
      .select()
      .from(portfolioCashFlowsTable)
      .where(
        and(
          gte(portfolioCashFlowsTable.occurredAt, STOCK_RETURN_INITIAL_AT),
          lte(portfolioCashFlowsTable.occurredAt, new Date()),
        )
      ),
    db
      .select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.side, "buy"),
          eq(transactionsTable.status, "applied"),
          eq(transactionsTable.fundingSource, "CASH"),
          gte(transactionsTable.executedAt, STOCK_RETURN_INITIAL_AT),
          lte(transactionsTable.executedAt, new Date()),
        )
      ),
  ]);
  const asOf = new Date();
  const currentValue = portfolioSnapshot.totalValue;
  const currentCostBasis = portfolioSnapshot.holdingsWithValue.reduce(
    (sum, holding) => sum + (holding.costOfCapital ?? 0),
    0
  );
  const buyTransactionTotal = buyTransactions.reduce(
    (sum, transaction) => sum + parseFloat(String(transaction.totalValue)),
    0
  );

  const externalCashFlowRows = externalCashFlows.flatMap((flow) => {
    const amount = parseFloat(String(flow.amount));
    if (!Number.isFinite(amount) || amount <= 0) return [];

    const normalizedKind = flow.kind.trim().toLowerCase();
    const signedAmount =
      normalizedKind === "deposit" || normalizedKind === "contribution"
        ? -amount
        : normalizedKind === "withdrawal"
          ? amount
          : null;

    if (signedAmount == null) return [];

    return [{
      date: flow.occurredAt,
      amount: signedAmount,
      kind: normalizedKind,
      source: flow.source || flow.origin || "portfolio_cash_flows",
      note: flow.note,
      rowType: "external_cash_flow" as const,
    }];
  });
  const externalCapitalDelta = externalCashFlowRows.reduce((sum, flow) => sum - flow.amount, 0);
  const initialCapital = Math.max(0, currentCostBasis - buyTransactionTotal - externalCapitalDelta);

  const cashFlows = [
    {
      date: STOCK_RETURN_INITIAL_AT,
      amount: -initialCapital,
      kind: "initial_capital",
      source: "portfolio_snapshot",
      note: "Total capital",
      rowType: "portfolio_start_capital" as const,
    },
    ...externalCashFlowRows,
    {
      date: asOf,
      amount: currentValue,
      kind: "current_value",
      source: "portfolio_snapshot",
      note: "Current portfolio value",
      rowType: "portfolio_current_value" as const,
    },
  ];

  const xirrAnnual = calculateXirr(cashFlows);
  const xirrMonthly = xirrAnnual == null ? null : Math.pow(1 + xirrAnnual, 1 / 12) - 1;

  return {
    asOf,
    currentValue,
    initialCapital,
    rawInitialCapital: currentCostBasis,
    buyTransactionTotal,
    externalCashFlowTotal: externalCashFlowRows.reduce((sum, flow) => sum + flow.amount, 0),
    cashFlowCount: cashFlows.length,
    hasNegativeCashFlow: cashFlows.some((flow) => flow.amount < 0),
    hasPositiveCashFlow: cashFlows.some((flow) => flow.amount > 0),
    mode: "portfolio_cash_flow_xirr" as const,
    reason: initialCapital <= 0 || currentValue <= 0
      ? "Portfolio XIRR needs beginning capital and current portfolio value."
      : null,
    xirrAnnual,
    xirrMonthly,
    cashFlows,
  };
}

const CreatePortfolioCashFlowBody = z.object({
  kind: z.enum(["deposit", "withdrawal", "cash_yield", "manual_adjustment", "contribution"]),
  account: z.string().trim().min(1).default("CASH"),
  amount: z.coerce.number().positive(),
  note: z.string().trim().optional().nullable(),
  occurredAt: z.coerce.date().optional(),
});

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
  const { totalValue, stockValue, goldValue, lastUpdatedDate, holdingsWithValue } = await getPortfolioCurrentValueSnapshot();

  res.json(
    GetPortfolioSummaryResponse.parse({
      totalValue,
      stockValue,
      goldValue,
      lastUpdated: lastUpdatedDate,
      holdings: holdingsWithValue,
    })
  );
});

router.get("/portfolio/xirr", async (_req, res): Promise<void> => {
  const snapshot = await buildPortfolioXirrSnapshot();
  res.json(snapshot);
});

router.get("/portfolio/xirr/export", async (_req, res): Promise<void> => {
  const snapshot = await buildPortfolioXirrSnapshot();
  const rows = [
    [
      "meta",
      "",
      snapshot.asOf.toISOString(),
      "",
      "",
      "",
      "",
      snapshot.initialCapital,
      snapshot.currentValue,
      snapshot.xirrAnnual ?? "",
      snapshot.xirrMonthly ?? "",
      snapshot.hasNegativeCashFlow ? "true" : "false",
      snapshot.hasPositiveCashFlow ? "true" : "false",
      snapshot.reason ?? "",
    ],
    ...snapshot.cashFlows.map((flow) => [
      flow.rowType,
      flow.kind,
      flow.date.toISOString(),
      flow.source,
      flow.note ?? "",
      flow.amount < 0 ? "out" : "in",
      flow.amount,
      snapshot.initialCapital,
      snapshot.currentValue,
      snapshot.xirrAnnual ?? "",
      snapshot.xirrMonthly ?? "",
      snapshot.hasNegativeCashFlow ? "true" : "false",
      snapshot.hasPositiveCashFlow ? "true" : "false",
      "",
    ]),
  ];

  const header = [
    "row_type",
    "kind",
    "date",
    "source",
    "note",
    "direction",
    "amount",
    "initial_capital",
    "current_portfolio_value",
    "xirr_annual",
    "xirr_monthly",
    "has_negative_cash_flow",
    "has_positive_cash_flow",
    "reason",
  ];
  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="portfolio-xirr-debug-${snapshot.asOf.toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}`);
});

router.get("/portfolio/cash-flows", async (_req, res): Promise<void> => {
  const rows = await db.select().from(portfolioCashFlowsTable).orderBy(portfolioCashFlowsTable.occurredAt);
  res.json(rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    account: row.account,
    origin: row.origin,
    amount: parseFloat(String(row.amount)),
    note: row.note,
    source: row.source,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })));
});

router.post("/portfolio/cash-flows", async (req, res): Promise<void> => {
  const parsed = CreatePortfolioCashFlowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const kind = parsed.data.kind === "contribution" ? "deposit" : parsed.data.kind;
  const amount = parsed.data.amount;
  const delta = kind === "deposit" ? amount : -amount;

  // 1. Log the cash flow
  const [created] = await db
    .insert(portfolioCashFlowsTable)
    .values({
      kind,
      account: parsed.data.account.toUpperCase(),
      origin: "manual",
      amount: String(amount),
      note: parsed.data.note || null,
      source: "manual",
      occurredAt: parsed.data.occurredAt ?? new Date(),
    })
    .returning();

  // 2. Update the Cash holding balance
  await adjustCashHolding(delta);

  res.status(201).json({
    id: created.id,
    kind: created.kind,
    account: created.account,
    origin: created.origin,
    amount: parseFloat(String(created.amount)),
    note: created.note,
    source: created.source,
    occurredAt: created.occurredAt,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  });
});

async function adjustCashHolding(delta: number): Promise<void> {
  if (delta === 0) return;
  const cashHolding = await db
    .select()
    .from(holdingsTable)
    .where(sql`lower(${holdingsTable.type}) = 'cash' OR lower(${holdingsTable.symbol}) = 'cash'`)
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!cashHolding) {
    if (delta > 0) {
      await db.insert(holdingsTable).values({ symbol: "CASH", type: "cash", quantity: "1", manualPrice: String(delta), costOfCapital: String(delta) });
    }
    return;
  }

  const current = cashHolding.manualPrice != null
    ? parseFloat(String(cashHolding.manualPrice))
    : parseFloat(String(cashHolding.quantity));
  const newPrice = Math.max(0, current + delta);
  await db.update(holdingsTable).set({
    manualPrice: String(newPrice),
    updatedAt: new Date(),
  }).where(eq(holdingsTable.id, cashHolding.id));

  try {
    await fetch(`http://localhost:${process.env["PORT"] ?? 4000}/api/excel/investment/update-price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: cashHolding.symbol.toUpperCase(), price: newPrice }),
    });
  } catch { /* non-fatal */ }
}

const UpdatePortfolioCashFlowBody = z.object({
  kind: z.enum(["deposit", "withdrawal"]),
  amount: z.coerce.number().positive(),
  note: z.string().trim().optional().nullable(),
  occurredAt: z.coerce.date().optional(),
});

router.post("/portfolio/cash-flows/recalculate", async (_req, res): Promise<void> => {
  const [flows, transactions] = await Promise.all([
    db.select().from(portfolioCashFlowsTable),
    db.select().from(transactionsTable),
  ]);
  const total = flows.reduce((sum, flow) => {
    const amount = parseFloat(String(flow.amount));
    return flow.kind === "deposit" ? sum + amount : sum - amount;
  }, 0);
  const tradeCashFlow = transactions.reduce((sum, transaction) => {
    if (transaction.status !== "applied") return sum;
    if (transaction.fundingSource.trim().toUpperCase() !== "CASH") return sum;
    const amount = parseFloat(String(transaction.totalValue));
    return sum + (transaction.side === "buy" ? -amount : amount);
  }, 0);
  const newPrice = Math.max(0, total + tradeCashFlow);

  let cashHolding = await db
    .select()
    .from(holdingsTable)
    .where(sql`lower(${holdingsTable.type}) = 'cash' OR lower(${holdingsTable.symbol}) = 'cash'`)
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (cashHolding) {
    await db.update(holdingsTable).set({
      manualPrice: String(newPrice),
      updatedAt: new Date(),
    }).where(eq(holdingsTable.id, cashHolding.id));
  } else {
    const [created] = await db.insert(holdingsTable).values({
      symbol: "CASH",
      type: "cash",
      quantity: "1",
      manualPrice: String(newPrice),
      costOfCapital: String(Math.max(0, total)),
    }).returning();
    cashHolding = created ?? null;
  }

  if (cashHolding) {
    try {
      await fetch(`http://localhost:${process.env["PORT"] ?? 4000}/api/excel/investment/update-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: cashHolding.symbol.toUpperCase(), price: newPrice }),
      });
    } catch { /* non-fatal */ }
  }

  res.json({ success: true, newCashBalance: newPrice, flowCount: flows.length });
});

router.put("/portfolio/cash-flows/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "");
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdatePortfolioCashFlowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(portfolioCashFlowsTable).where(eq(portfolioCashFlowsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Cash flow not found" }); return; }

  const oldDelta = existing.kind === "deposit" ? parseFloat(String(existing.amount)) : -parseFloat(String(existing.amount));
  const newDelta = parsed.data.kind === "deposit" ? parsed.data.amount : -parsed.data.amount;
  const netDelta = newDelta - oldDelta;

  const [updated] = await db
    .update(portfolioCashFlowsTable)
    .set({
      kind: parsed.data.kind,
      amount: String(parsed.data.amount),
      note: parsed.data.note ?? null,
      occurredAt: parsed.data.occurredAt ?? existing.occurredAt,
    })
    .where(eq(portfolioCashFlowsTable.id, id))
    .returning();

  await adjustCashHolding(netDelta);

  res.json({
    id: updated!.id, kind: updated!.kind, account: updated!.account, origin: updated!.origin,
    amount: parseFloat(String(updated!.amount)), note: updated!.note, source: updated!.source,
    occurredAt: updated!.occurredAt, createdAt: updated!.createdAt, updatedAt: updated!.updatedAt,
  });
});

router.delete("/portfolio/cash-flows/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "");
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portfolioCashFlowsTable).where(eq(portfolioCashFlowsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Cash flow not found" }); return; }

  const reverseDelta = existing.kind === "deposit"
    ? -parseFloat(String(existing.amount))
    : parseFloat(String(existing.amount));

  await db.delete(portfolioCashFlowsTable).where(eq(portfolioCashFlowsTable.id, id));
  await adjustCashHolding(reverseDelta);

  res.json({ success: true });
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
  const goldBenchmark = prices.find((price) => normalizeHoldingType(price.type) === "gold");
  const goldPrice = goldBenchmark ? parseFloat(String(goldBenchmark.price)) : null;
  const today = new Date();

  const rows = holdings.map((holding) => {
    const symbol = holding.symbol.toUpperCase();
    const quantity = parseFloat(String(holding.quantity));
    const costOfCapital = holding.costOfCapital != null ? parseFloat(String(holding.costOfCapital)) : null;
    const manualPrice = holding.manualPrice != null ? parseFloat(String(holding.manualPrice)) : null;
    const normalizedType = normalizeHoldingType(holding.type);
    const currentPrice = priceMap.get(symbol) ?? (normalizedType === "gold" ? goldPrice : null) ?? manualPrice;
    const currentValue = resolveHoldingCurrentValue({ type: holding.type, quantity, currentPrice });
    const unrealizedPnL =
      costOfCapital != null && currentValue != null ? currentValue - costOfCapital : null;
    const unrealizedPnLPercent =
      costOfCapital != null && costOfCapital > 0 && unrealizedPnL != null
        ? unrealizedPnL / costOfCapital
        : null;

    const xirrAnnual =
      costOfCapital != null && costOfCapital > 0 && currentValue != null
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
