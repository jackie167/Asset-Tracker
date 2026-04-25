import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AllocationChart from "@/pages/assets/AllocationChart";
import AssetsHeader from "@/pages/assets/AssetsHeader";
import HoldingsTable from "@/pages/assets/HoldingsTable";
import PerformanceChart from "@/pages/assets/PerformanceChart";
import PortfolioSummaryCard from "@/pages/assets/PortfolioSummaryCard";
import type { ChartPoint, HoldingItem, SnapshotRange, SortOrder } from "@/pages/assets/types";
import { formatTypeLabel, formatVND, formatVNDFull } from "@/pages/assets/utils";
import { fetchWealthAllocationHoldings } from "@/pages/wealthAllocationData";

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

async function fetchPortfolioXirr(): Promise<{ xirrAnnual: number | null; xirrMonthly: number | null }> {
  const res = await fetch("/api/portfolio/xirr");
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status} ${res.statusText}`);
  return {
    xirrAnnual: typeof data?.xirrAnnual === "number" ? data.xirrAnnual : null,
    xirrMonthly: typeof data?.xirrMonthly === "number" ? data.xirrMonthly : null,
  };
}

async function fetchPortfolioSummaryPnL(): Promise<{ totalPnL: number | null; totalPnLPercent: number | null }> {
  const res = await fetch("/api/portfolio/summary");
  const data = await res.json().catch(() => null);
  if (!res.ok) return { totalPnL: null, totalPnLPercent: null };
  const holdings: Array<{ currentValue?: number | null; costOfCapital?: number | null }> = data?.holdings ?? [];
  const totalCapital = holdings.reduce((sum, h) => sum + (h.costOfCapital ?? 0), 0);
  const totalCurrent = holdings.reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
  const totalPnL = totalCurrent - totalCapital;
  const totalPnLPercent = totalCapital > 0 ? totalPnL / totalCapital : null;
  return { totalPnL, totalPnLPercent };
}

export default function WealthAllocationPage() {
  const [, navigate] = useLocation();
  const [snapshotRange, setSnapshotRange] = useState<SnapshotRange>("1m");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [holdingsCollapsed, setHoldingsCollapsed] = useState<boolean>(
    () => localStorage.getItem("wealth_holdings_collapsed") !== "0"
  );
  const [filterType, setFilterType] = useState<string>("all");
  const [hideValues, setHideValues] = useState<boolean>(() => localStorage.getItem("hide_values") === "1");
  const [showQtyCol, setShowQtyCol] = useState<boolean>(() => localStorage.getItem("wealth_col_qty") === "1");
  const [showPriceCol, setShowPriceCol] = useState<boolean>(() => localStorage.getItem("wealth_col_price") === "1");
  const [holdings, setHoldings] = useState<HoldingItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portfolioXirrQuery = useQuery({
    queryKey: ["portfolio-xirr"],
    queryFn: fetchPortfolioXirr,
  });

  const portfolioPnLQuery = useQuery({
    queryKey: ["portfolio-pnl"],
    queryFn: fetchPortfolioSummaryPnL,
  });

  const loadWealthAllocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setHoldings(await fetchWealthAllocationHoldings());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load wealth allocation sheet.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWealthAllocation();
  }, [loadWealthAllocation]);

  const totalValue = useMemo(
    () => holdings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0),
    [holdings]
  );

  const sortedHoldings = useMemo(() => {
    if (sortOrder === "none") return holdings;
    return [...holdings].sort((a, b) => {
      const aValue = a.currentValue ?? 0;
      const bValue = b.currentValue ?? 0;
      return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [holdings, sortOrder]);

  const availableTypes = useMemo(
    () => [...new Set(holdings.map((holding) => holding.type.toLowerCase()))].sort(),
    [holdings]
  );

  const filteredHoldings = useMemo(
    () => (filterType === "all" ? sortedHoldings : sortedHoldings.filter((holding) => holding.type.toLowerCase() === filterType)),
    [filterType, sortedHoldings]
  );

  const filteredTotal = useMemo(
    () => filteredHoldings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0),
    [filteredHoldings]
  );

  const chartData: ChartPoint[] = [];

  const formatMoney = (value: number | null | undefined, full = false) =>
    hideValues ? "****" : full ? formatVNDFull(value) : formatVND(value);

  const sortLabel =
    sortOrder === "desc" ? "↓ High → Low" : sortOrder === "asc" ? "↑ Low → High" : "Sort";

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
    localStorage.setItem("wealth_holdings_collapsed", next ? "1" : "0");
  };

  const toggleHideValues = () => {
    const next = !hideValues;
    setHideValues(next);
    localStorage.setItem("hide_values", next ? "1" : "0");
  };

  const toggleQtyCol = () => {
    const value = !showQtyCol;
    setShowQtyCol(value);
    localStorage.setItem("wealth_col_qty", value ? "1" : "0");
  };

  const togglePriceCol = () => {
    const value = !showPriceCol;
    setShowPriceCol(value);
    localStorage.setItem("wealth_col_price", value ? "1" : "0");
  };

  const handleExportCSV = () => {
    if (!holdings.length) return;
    const formatNumber = (value: number) => value.toLocaleString("vi-VN");
    const header = ["asset", "type", "current_value"];
    const rows = holdings.map((holding) => [
      holding.symbol,
      formatTypeLabel(holding.type),
      holding.currentValue != null ? formatNumber(Math.round(holding.currentValue)) : "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wealth-allocation-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenAssetType = (type: string) => {
    navigate(`/wealth-allocation/type/${encodeURIComponent(type)}`);
  };

  const pnl = portfolioPnLQuery.data?.totalPnL ?? null;
  const pnlPercent = portfolioPnLQuery.data?.totalPnLPercent ?? null;
  const xirrAnnual = portfolioXirrQuery.data?.xirrAnnual ?? null;
  const xirrMonthly = portfolioXirrQuery.data?.xirrMonthly ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AssetsHeader
        title="WEALTH ALLOCATION"
        hasHoldings={holdings.length > 0}
        onExport={handleExportCSV}
      />

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 space-y-4">
        {error ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">{error}</div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading...</div>
        ) : (
          <>
            <PortfolioSummaryCard
              totalValueLabel={formatMoney(totalValue, true)}
              hideValues={hideValues}
              onToggleHideValues={toggleHideValues}
              metrics={[
                {
                  label: "P/L",
                  value: pnl != null ? formatVNDFull(pnl) : "—",
                  tone: pnl == null ? "neutral" : pnl >= 0 ? "positive" : "negative",
                },
                {
                  label: "P/L %",
                  value: formatPercent(pnlPercent),
                  tone: pnlPercent == null ? "neutral" : pnlPercent >= 0 ? "positive" : "negative",
                },
                {
                  label: "XIRR / Year",
                  value: formatPercent(xirrAnnual),
                  tone: xirrAnnual == null ? "neutral" : xirrAnnual >= 0 ? "positive" : "negative",
                },
                {
                  label: "XIRR / Month",
                  value: formatPercent(xirrMonthly),
                  tone: xirrMonthly == null ? "neutral" : xirrMonthly >= 0 ? "positive" : "negative",
                },
              ]}
            />

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
                emptyMessage="No wealth history yet."
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
              formatMoney={formatMoney}
              onToggleHoldingsCollapsed={toggleHoldingsCollapsed}
              onToggleQtyCol={toggleQtyCol}
              onTogglePriceCol={togglePriceCol}
              onFilterTypeChange={setFilterType}
              onCycleSortOrder={cycleSortOrder}
              readOnly
            />
          </>
        )}
      </main>
    </div>
  );
}
