import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import TradeOrdersTable, { type TradeOrder } from "@/pages/assets/TradeOrdersTable";

async function fetchTradeOrders(): Promise<TradeOrder[]> {
  const res = await fetch("/api/transactions");
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

export default function TransactionsPage() {
  const tradeOrdersQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: fetchTradeOrders,
  });
  const orders = tradeOrdersQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-3 sm:px-4 md:px-6 py-3 sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold tracking-[0.18em]">TRANSACTIONS</h1>
            <p className="text-xs text-muted-foreground leading-relaxed">Recorded trade orders for debugging</p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/assets" className="hover:text-foreground transition-colors">Investment</Link>
            <Link href="/wealth-allocation" className="hover:text-foreground transition-colors">Wealth Allocation</Link>
            <Link href="/excel" className="hover:text-foreground transition-colors">Excel</Link>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={!orders.length}
              onClick={() => exportTradeOrdersCSV(orders)}
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                void exportPortfolioXirrDebugCSV();
              }}
            >
              Export XIRR DB
            </Button>
          </nav>
        </div>
      </header>

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 space-y-4">
        {tradeOrdersQuery.isError ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            {tradeOrdersQuery.error instanceof Error ? tradeOrdersQuery.error.message : "Unable to load transactions."}
          </div>
        ) : (
          <TradeOrdersTable
            orders={orders}
            isLoading={tradeOrdersQuery.isLoading}
            limit={0}
          />
        )}
      </main>
    </div>
  );
}
