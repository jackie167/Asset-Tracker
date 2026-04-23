import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import TradeOrdersTable, { type TradeOrder } from "@/pages/assets/TradeOrdersTable";

async function fetchTradeOrders(): Promise<TradeOrder[]> {
  const res = await fetch("/api/transactions");
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

export default function TransactionsPage() {
  const tradeOrdersQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: fetchTradeOrders,
  });

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
            orders={tradeOrdersQuery.data ?? []}
            isLoading={tradeOrdersQuery.isLoading}
            limit={0}
          />
        )}
      </main>
    </div>
  );
}
