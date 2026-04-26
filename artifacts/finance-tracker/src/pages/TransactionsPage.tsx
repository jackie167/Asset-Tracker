import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGetPortfolioSummaryQueryKey,
  getListHoldingsQueryKey,
  getListSnapshotsQueryKey,
} from "@workspace/api-client-react";
import TradeOrdersTable, { type TradeOrder } from "@/pages/assets/TradeOrdersTable";
import TradeDialog from "@/pages/assets/TradeDialog";
import type { HoldingItem } from "@/pages/assets/types";
import PageHeader from "@/pages/PageHeader";
import { useToast } from "@/hooks/use-toast";

async function fetchTradeOrders(): Promise<TradeOrder[]> {
  const res = await fetch("/api/transactions");
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

type CashFlow = {
  id: number;
  kind: string;
  account: string;
  origin: string;
  amount: number;
  note: string | null;
  source: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
};

async function fetchCashFlows(): Promise<CashFlow[]> {
  const res = await fetch("/api/portfolio/cash-flows");
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function exportPortfolioXirrDebugCSV() {
  const res = await fetch("/api/portfolio/xirr/export");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status} ${res.statusText}`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
  const filename = filenameMatch?.[1] || `portfolio-xirr-debug-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function exportTradeOrdersCSV(orders: TradeOrder[]) {
  const headers = [
    "id",
    "side",
    "origin",
    "asset",
    "asset_type",
    "quantity",
    "total_value",
    "unit_price",
    "realized_interest",
    "funding_source",
    "status",
    "executed_at",
    "created_at",
    "updated_at",
    "note",
  ];
  const rows = orders.map((order) => [
    order.id,
    order.side,
    order.origin ?? "",
    order.symbol,
    order.assetType,
    order.quantity,
    order.totalValue,
    order.unitPrice ?? "",
    order.realizedInterest ?? "",
    order.fundingSource,
    order.status,
    order.executedAt,
    order.createdAt ?? "",
    order.updatedAt ?? "",
    order.note ?? "",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function fetchHoldings(): Promise<HoldingItem[]> {
  const res = await fetch("/api/portfolio/summary");
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return data?.holdings ?? [];
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<TradeOrder | null>(null);

  const tradeOrdersQuery = useQuery({ queryKey: ["transactions"], queryFn: fetchTradeOrders });
  const cashFlowsQuery   = useQuery({ queryKey: ["portfolio-cash-flows"], queryFn: fetchCashFlows });
  const holdingsQuery    = useQuery({ queryKey: ["holdings-for-trade"], queryFn: fetchHoldings });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["portfolio-xirr"] });
  };

  const tradeBody = (body: { side: "buy"|"sell"; fundingSource: string; assetType: string; symbol: string; quantity: number; totalValue: number; note?: string; executedAt?: string }) =>
    ({ ...body, fundingSource: "CASH" });

  const createTrade = useMutation({
    mutationFn: async (body: Parameters<typeof tradeBody>[0]) => {
      const res = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tradeBody(body)) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Không thể lưu giao dịch.");
      return data as TradeOrder;
    },
    onSuccess: () => { invalidate(); setTradeDialogOpen(false); toast({ title: "Đã lưu giao dịch" }); },
    onError: (err) => toast({ title: "Lỗi", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const updateTrade = useMutation({
    mutationFn: async (body: Parameters<typeof tradeBody>[0]) => {
      if (!editingOrder) throw new Error("No order selected.");
      const res = await fetch(`/api/transactions/${editingOrder.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tradeBody(body)) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Không thể cập nhật.");
      return data as TradeOrder;
    },
    onSuccess: () => { invalidate(); setTradeDialogOpen(false); setEditingOrder(null); toast({ title: "Đã cập nhật giao dịch" }); },
    onError: (err) => toast({ title: "Lỗi", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const deleteTrade = useMutation({
    mutationFn: async (order: TradeOrder) => {
      const res = await fetch(`/api/transactions/${order.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => { invalidate(); toast({ title: "Đã xóa giao dịch" }); },
    onError: (err) => toast({ title: "Lỗi", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  const [cashFlowKind, setCashFlowKind] = useState<"deposit" | "withdrawal">("deposit");
  const [cashFlowAmount, setCashFlowAmount] = useState("");
  const [cashFlowOccurredAt, setCashFlowOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [cashFlowNote, setCashFlowNote] = useState("");
  const orders = tradeOrdersQuery.data ?? [];
  const cashFlows = cashFlowsQuery.data ?? [];
  const cashFlowBalance = useMemo(
    () =>
      cashFlows.reduce((sum, flow) => {
        const sign = flow.kind === "withdrawal" ? -1 : 1;
        return sum + sign * flow.amount;
      }, 0),
    [cashFlows]
  );

  const createCashFlowMutation = useMutation({
    mutationFn: async (body: { kind: "deposit" | "withdrawal"; amount: number; occurredAt?: string; note?: string }) => {
      const res = await fetch("/api/portfolio/cash-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: body.kind,
          account: "CASH",
          amount: body.amount,
          occurredAt: body.occurredAt ? new Date(`${body.occurredAt}T00:00:00+07:00`).toISOString() : undefined,
          note: body.note?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Unable to save cash flow.");
      return data as CashFlow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-cash-flows"] });
      setCashFlowAmount("");
      setCashFlowNote("");
    },
  });

  const handleCashFlowSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedAmount = Number(cashFlowAmount.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) return;
    createCashFlowMutation.mutate({
      kind: cashFlowKind,
      amount: normalizedAmount,
      occurredAt: cashFlowOccurredAt,
      note: cashFlowNote,
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader
        title="Transactions"
        subtitle="Giao dịch mua bán & dòng tiền đầu tư"
        actions={[
          { kind: "item", label: "Thêm giao dịch", onSelect: () => { setEditingOrder(null); setTradeDialogOpen(true); } },
          { kind: "separator" },
          { kind: "item", label: "Export CSV", onSelect: () => exportTradeOrdersCSV(orders), disabled: !orders.length },
          { kind: "item", label: "Export XIRR Debug", onSelect: () => { void exportPortfolioXirrDebugCSV(); } },
        ]}
      />

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 space-y-4">
        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xs text-muted-foreground uppercase tracking-widest">Cash Flows</h2>
              <p className="text-xs text-muted-foreground mt-1">Debug ledger for deposit and withdrawal before wiring cash P/L to it.</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Net Flow</div>
              <div className="text-sm font-semibold tabular-nums">{cashFlowBalance.toLocaleString("vi-VN")} đ</div>
            </div>
          </div>

          <form className="grid gap-2 md:grid-cols-[120px_1fr_160px_1.4fr_auto]" onSubmit={handleCashFlowSubmit}>
            <Select value={cashFlowKind} onValueChange={(value) => setCashFlowKind(value as "deposit" | "withdrawal")}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deposit">Deposit</SelectItem>
                <SelectItem value="withdrawal">Withdrawal</SelectItem>
              </SelectContent>
            </Select>
            <input
              value={cashFlowAmount}
              onChange={(event) => setCashFlowAmount(event.target.value)}
              placeholder="Amount"
              inputMode="decimal"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <input
              type="date"
              value={cashFlowOccurredAt}
              onChange={(event) => setCashFlowOccurredAt(event.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <input
              value={cashFlowNote}
              onChange={(event) => setCashFlowNote(event.target.value)}
              placeholder="Note"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <Button type="submit" size="sm" className="h-9" disabled={createCashFlowMutation.isPending}>
              Add
            </Button>
          </form>

          {createCashFlowMutation.isError && (
            <p className="text-xs text-red-300">
              {createCashFlowMutation.error instanceof Error ? createCashFlowMutation.error.message : "Unable to save cash flow."}
            </p>
          )}

          {cashFlowsQuery.isError ? (
            <p className="text-xs text-red-300">
              {cashFlowsQuery.error instanceof Error ? cashFlowsQuery.error.message : "Unable to load cash flows."}
            </p>
          ) : cashFlows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No deposit or withdrawal recorded yet.</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-[9px] text-muted-foreground uppercase tracking-wider border-b border-border">
                    <th className="py-1.5 pr-3 text-left font-normal">Kind</th>
                    <th className="py-1.5 px-3 text-right font-normal">Amount</th>
                    <th className="py-1.5 px-3 text-left font-normal">Account</th>
                    <th className="py-1.5 px-3 text-left font-normal">Origin</th>
                    <th className="py-1.5 px-3 text-left font-normal">Note</th>
                    <th className="py-1.5 pl-3 text-right font-normal">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cashFlows].reverse().map((flow) => (
                    <tr key={flow.id} className="border-b border-border last:border-0">
                      <td className={`py-2 pr-3 font-medium uppercase ${flow.kind === "withdrawal" ? "text-amber-300" : "text-emerald-400"}`}>
                        {flow.kind}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium">
                        {flow.amount.toLocaleString("vi-VN")} đ
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{flow.account}</td>
                      <td className="py-2 px-3 text-muted-foreground">{flow.origin}</td>
                      <td className="py-2 px-3 text-muted-foreground">{flow.note || "—"}</td>
                      <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                        {new Date(flow.occurredAt).toLocaleDateString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {tradeOrdersQuery.isError ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            {tradeOrdersQuery.error instanceof Error ? tradeOrdersQuery.error.message : "Unable to load transactions."}
          </div>
        ) : (
          <TradeOrdersTable
            orders={orders}
            isLoading={tradeOrdersQuery.isLoading}
            limit={0}
            onEdit={(order) => { setEditingOrder(order); setTradeDialogOpen(true); }}
            onDelete={(order) => deleteTrade.mutate(order)}
          />
        )}
      </main>

      <TradeDialog
        open={tradeDialogOpen}
        holdings={holdingsQuery.data ?? []}
        editingOrder={editingOrder}
        isSaving={createTrade.isPending || updateTrade.isPending}
        onClose={() => { setTradeDialogOpen(false); setEditingOrder(null); }}
        onSubmit={(body) => editingOrder ? updateTrade.mutate(body) : createTrade.mutate(body)}
      />
    </div>
  );
}
