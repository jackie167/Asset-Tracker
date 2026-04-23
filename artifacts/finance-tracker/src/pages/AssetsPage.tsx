import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetPortfolioSummaryQueryKey,
  getListHoldingsQueryKey,
  getListSnapshotsQueryKey,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { usePortfolioData } from "@/hooks/use-portfolio";
import { useToast } from "@/hooks/use-toast";
import AllocationChart from "@/pages/assets/AllocationChart";
import AssetsHeader from "@/pages/assets/AssetsHeader";
import HoldingsTable from "@/pages/assets/HoldingsTable";
import PerformanceChart from "@/pages/assets/PerformanceChart";
import PortfolioSummaryCard from "@/pages/assets/PortfolioSummaryCard";
import TradeDialog from "@/pages/assets/TradeDialog";
import TradeOrdersTable, { type TradeOrder } from "@/pages/assets/TradeOrdersTable";
import type { ChartPoint, HoldingItem, SnapshotRange, SortOrder } from "@/pages/assets/types";
import { formatVND, formatVNDFull } from "@/pages/assets/utils";

async function fetchTradeOrders(): Promise<TradeOrder[]> {
  const res = await fetch("/api/transactions");
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

type StockReturnEstimate = {
  symbol: string;
  initialAt: string;
  asOf: string;
  quantity: number;
  costOfCapital: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number | null;
  xirrAnnual: number | null;
  xirrMonthly: number | null;
};

async function fetchMwgReturnEstimate(): Promise<StockReturnEstimate> {
  const res = await fetch("/api/portfolio/returns/stock/MWG");
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status} ${res.statusText}`);
  return data as StockReturnEstimate;
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export default function AssetsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [snapshotRange, setSnapshotRange] = useState<SnapshotRange>("1m");
  const { summary, snapshots, holdings: holdingsFromApi, isLoading, isError, error } = usePortfolioData(snapshotRange);
  const tradeOrdersQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: fetchTradeOrders,
  });
  const mwgReturnQuery = useQuery({
    queryKey: ["stock-return-estimate", "MWG"],
    queryFn: fetchMwgReturnEstimate,
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [holdingsCollapsed, setHoldingsCollapsed] = useState<boolean>(
    () => localStorage.getItem("holdings_collapsed") !== "0"
  );
  const [filterType, setFilterType] = useState<string>("all");
  const [hideValues, setHideValues] = useState<boolean>(() => localStorage.getItem("hide_values") === "1");
  const [showQtyCol, setShowQtyCol] = useState<boolean>(() => localStorage.getItem("col_sl") !== "0");
  const [showPriceCol, setShowPriceCol] = useState<boolean>(() => localStorage.getItem("col_gia") !== "0");
  const [showCostOfCapitalCol, setShowCostOfCapitalCol] = useState<boolean>(
    () => localStorage.getItem("col_cost_of_capital") !== "0"
  );
  const [showInterestCol, setShowInterestCol] = useState<boolean>(
    () => localStorage.getItem("col_interest") !== "0"
  );
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [editingTradeOrder, setEditingTradeOrder] = useState<TradeOrder | null>(null);

  const invalidatePortfolioAfterTrade = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["stock-return-estimate", "MWG"] });
  };

  const tradeBodyToRequest = (body: {
    side: "buy" | "sell";
    fundingSource: string;
    assetType: string;
    symbol: string;
    quantity: number;
    totalValue: number;
    note?: string;
  }) => ({
    ...body,
    fundingSource: "CASH",
  });

  const createTradeMutation = useMutation({
    mutationFn: async (body: {
      side: "buy" | "sell";
      fundingSource: string;
      assetType: string;
      symbol: string;
      quantity: number;
      totalValue: number;
      note?: string;
    }) => {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tradeBodyToRequest(body)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Unable to save trade.");
      return data as TradeOrder;
    },
    onSuccess: () => {
      invalidatePortfolioAfterTrade();
      setTradeDialogOpen(false);
      toast({ title: "Trade saved", description: "The order was recorded in the database." });
    },
    onError: (err) => {
      toast({
        title: "Trade save failed",
        description: err instanceof Error ? err.message : "Unable to save trade.",
        variant: "destructive",
      });
    },
  });

  const updateTradeMutation = useMutation({
    mutationFn: async (body: {
      side: "buy" | "sell";
      fundingSource: string;
      assetType: string;
      symbol: string;
      quantity: number;
      totalValue: number;
      note?: string;
    }) => {
      if (!editingTradeOrder) throw new Error("No trade selected.");
      const res = await fetch(`/api/transactions/${editingTradeOrder.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tradeBodyToRequest(body)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Unable to update trade.");
      return data as TradeOrder;
    },
    onSuccess: () => {
      invalidatePortfolioAfterTrade();
      setTradeDialogOpen(false);
      setEditingTradeOrder(null);
      toast({ title: "Trade updated", description: "The order content was updated." });
    },
    onError: (err) => {
      toast({
        title: "Trade update failed",
        description: err instanceof Error ? err.message : "Unable to update trade.",
        variant: "destructive",
      });
    },
  });

  const deleteTradeMutation = useMutation({
    mutationFn: async (order: TradeOrder) => {
      const res = await fetch(`/api/transactions/${order.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Unable to delete trade.");
      }
    },
    onSuccess: () => {
      invalidatePortfolioAfterTrade();
      toast({ title: "Trade deleted", description: "The order was removed." });
    },
    onError: (err) => {
      toast({
        title: "Trade delete failed",
        description: err instanceof Error ? err.message : "Unable to delete trade.",
        variant: "destructive",
      });
    },
  });

  const holdings: HoldingItem[] = (summary?.holdings ?? holdingsFromApi) as HoldingItem[];
  const totalValue = summary?.totalValue ?? 0;
  const lastUpdated = summary?.lastUpdated;

  const chartData = [...(snapshots || [])]
    .sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime())
    .reduce((acc: ChartPoint[], snapshot) => {
      const dateKey = format(new Date(snapshot.snapshotAt), "dd/MM");
      const existing = acc.find((item) => item.date === dateKey);
      if (existing) {
        existing.totalValue = snapshot.totalValue;
        existing.stockValue = snapshot.stockValue;
        existing.goldValue = snapshot.goldValue;
      } else {
        acc.push({
          date: dateKey,
          totalValue: snapshot.totalValue,
          stockValue: snapshot.stockValue,
          goldValue: snapshot.goldValue,
        });
      }
      return acc;
    }, []);

  const sortedHoldings = useMemo(() => {
    if (sortOrder === "none") return holdings;
    return [...holdings].sort((a, b) => {
      const aValue = a.currentValue ?? 0;
      const bValue = b.currentValue ?? 0;
      return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [holdings, sortOrder]);

  const availableTypes = useMemo(() => {
    const types = [...new Set(holdings.map((holding) => holding.type.toLowerCase()))];
    return types.sort((a, b) => {
      if (a === "stock") return -1;
      if (b === "stock") return 1;
      if (a === "gold") return -1;
      if (b === "gold") return 1;
      if (a === "crypto") return -1;
      if (b === "crypto") return 1;
      return a.localeCompare(b);
    });
  }, [holdings]);

  const filteredHoldings = useMemo(
    () => (filterType === "all" ? sortedHoldings : sortedHoldings.filter((holding) => holding.type.toLowerCase() === filterType)),
    [filterType, sortedHoldings]
  );

  const filteredTotal = useMemo(
    () => filteredHoldings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0),
    [filteredHoldings]
  );

  const formatMoney = (value: number | null | undefined, full = false) =>
    hideValues ? "****" : full ? formatVNDFull(value) : formatVND(value);

  const cycleSortOrder = () => {
    setSortOrder((previous) => {
      if (previous === "none") return "desc";
      if (previous === "desc") return "asc";
      return "none";
    });
  };

  const toggleHoldingsCollapsed = () => {
    const next = !holdingsCollapsed;
    setHoldingsCollapsed(next);
    localStorage.setItem("holdings_collapsed", next ? "1" : "0");
  };

  const handleExportCSV = () => {
    if (!holdings.length) return;
    const formatNumber = (value: number) => value.toLocaleString("vi-VN");
    const header = ["symbol", "type", "quantity", "current_price", "total_value", "cost_of_capital", "interest"];
    const rows = holdings.map((holding) => [
      holding.symbol,
      holding.type,
      holding.quantity != null ? formatNumber(holding.quantity) : "",
      holding.currentPrice != null ? formatNumber(holding.currentPrice) : "",
      holding.currentValue != null ? formatNumber(Math.round(holding.currentValue)) : "",
      holding.costOfCapital != null ? formatNumber(Math.round(holding.costOfCapital)) : "",
      holding.interest != null ? formatNumber(Math.round(holding.interest)) : "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `danh-muc-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sortLabel =
    sortOrder === "desc" ? "↓ High → Low" : sortOrder === "asc" ? "↑ Low → High" : "Sort";

  const handleOpenAssetType = (type: string) => {
    navigate(`/assets/type/${encodeURIComponent(type)}`);
  };

  const toggleHideValues = () => {
    const next = !hideValues;
    setHideValues(next);
    localStorage.setItem("hide_values", next ? "1" : "0");
  };

  const toggleQtyCol = () => {
    const value = !showQtyCol;
    setShowQtyCol(value);
    localStorage.setItem("col_sl", value ? "1" : "0");
  };

  const togglePriceCol = () => {
    const value = !showPriceCol;
    setShowPriceCol(value);
    localStorage.setItem("col_gia", value ? "1" : "0");
  };

  const toggleCostOfCapitalCol = () => {
    const value = !showCostOfCapitalCol;
    setShowCostOfCapitalCol(value);
    localStorage.setItem("col_cost_of_capital", value ? "1" : "0");
  };

  const toggleInterestCol = () => {
    const value = !showInterestCol;
    setShowInterestCol(value);
    localStorage.setItem("col_interest", value ? "1" : "0");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AssetsHeader
        lastUpdated={lastUpdated}
        hasHoldings={holdings.length > 0}
        onExport={handleExportCSV}
        onTrade={() => {
          setEditingTradeOrder(null);
          setTradeDialogOpen(true);
        }}
      />

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 space-y-4">
        {isError ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Unable to load data."}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : (
          <>
            <PortfolioSummaryCard
              totalValueLabel={formatMoney(totalValue, true)}
              hideValues={hideValues}
              onToggleHideValues={toggleHideValues}
            />

            <Card className="p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">MWG XIRR Estimate</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Basic estimate: 01/01/2026 capital to current market value
                  </p>
                </div>
                <span className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground">Debug</span>
              </div>

              {mwgReturnQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading MWG return...</p>
              ) : mwgReturnQuery.isError ? (
                <p className="text-xs text-muted-foreground">
                  {mwgReturnQuery.error instanceof Error ? mwgReturnQuery.error.message : "Unable to load MWG return."}
                </p>
              ) : mwgReturnQuery.data ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Capital</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">
                      {formatMoney(mwgReturnQuery.data.costOfCapital, true)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Value</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">
                      {formatMoney(mwgReturnQuery.data.currentValue, true)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Unrealized P/L</p>
                    <p className={`mt-1 text-sm font-semibold tabular-nums ${
                      mwgReturnQuery.data.unrealizedPnL >= 0 ? "text-emerald-400" : "text-red-300"
                    }`}>
                      {formatMoney(mwgReturnQuery.data.unrealizedPnL, true)}
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        ({formatPercent(mwgReturnQuery.data.unrealizedPnLPercent)})
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">XIRR</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">
                      {formatPercent(mwgReturnQuery.data.xirrAnnual)}
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        / year
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {formatPercent(mwgReturnQuery.data.xirrMonthly)} / month
                    </p>
                  </div>
                </div>
              ) : null}
            </Card>

            {totalValue > 0 && (
              <AllocationChart
                holdings={holdings}
                totalValue={totalValue}
                onTypeSelect={handleOpenAssetType}
              />
            )}

            {holdings.length > 0 && (
              <PerformanceChart
                title="Performance"
                chartData={chartData}
                hideValues={hideValues}
                selectedRange={snapshotRange}
                onRangeChange={setSnapshotRange}
              />
            )}
            <HoldingsTable
              holdings={holdings}
              filteredHoldings={filteredHoldings}
              totalValue={totalValue}
              filteredTotal={filteredTotal}
              filterType={filterType}
              availableTypes={availableTypes}
              sortOrder={sortOrder}
              sortLabel={sortLabel}
              holdingsCollapsed={holdingsCollapsed}
              showQtyCol={showQtyCol}
              showPriceCol={showPriceCol}
              showCostOfCapitalCol={showCostOfCapitalCol}
              showInterestCol={showInterestCol}
              formatMoney={formatMoney}
              onToggleHoldingsCollapsed={toggleHoldingsCollapsed}
              onToggleQtyCol={toggleQtyCol}
              onTogglePriceCol={togglePriceCol}
              onToggleCostOfCapitalCol={toggleCostOfCapitalCol}
              onToggleInterestCol={toggleInterestCol}
              onFilterTypeChange={setFilterType}
              onCycleSortOrder={cycleSortOrder}
              readOnly
            />

            <TradeOrdersTable
              orders={tradeOrdersQuery.data ?? []}
              isLoading={tradeOrdersQuery.isLoading}
              onEdit={(order) => {
                setEditingTradeOrder(order);
                setTradeDialogOpen(true);
              }}
              onDelete={(order) => {
                deleteTradeMutation.mutate(order);
              }}
            />
          </>
        )}
      </main>
      <TradeDialog
        open={tradeDialogOpen}
        holdings={holdings}
        editingOrder={editingTradeOrder}
        isSaving={createTradeMutation.isPending || updateTradeMutation.isPending}
        onClose={() => {
          setTradeDialogOpen(false);
          setEditingTradeOrder(null);
        }}
        onSubmit={(body) => {
          if (editingTradeOrder) {
            updateTradeMutation.mutate(body);
          } else {
            createTradeMutation.mutate(body);
          }
        }}
      />
    </div>
  );
}
