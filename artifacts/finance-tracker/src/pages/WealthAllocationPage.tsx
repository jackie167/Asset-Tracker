import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { usePortfolioData } from "@/hooks/use-portfolio";
import AllocationChart from "@/pages/assets/AllocationChart";
import AssetsHeader from "@/pages/assets/AssetsHeader";
import HoldingsTable from "@/pages/assets/HoldingsTable";
import PerformanceChart from "@/pages/assets/PerformanceChart";
import PortfolioSummaryCard from "@/pages/assets/PortfolioSummaryCard";
import type { ChartPoint, HoldingItem, SnapshotRange, SortOrder } from "@/pages/assets/types";
import { formatTypeLabel, formatVND, formatVNDFull } from "@/pages/assets/utils";

const EXCLUDED_TYPES = ["real_estate", "realestate", "real estate"];

function isFinancialType(type: string) {
  return !EXCLUDED_TYPES.includes(type.toLowerCase().trim());
}

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

  const { summary, snapshots, holdings: holdingsFromApi, isLoading, isError, error } = usePortfolioData(snapshotRange);
  const portfolioXirrQuery = useQuery({
    queryKey: ["portfolio-xirr"],
    queryFn: fetchPortfolioXirr,
  });

  const allHoldings = (summary?.holdings ?? holdingsFromApi) as HoldingItem[];
  const holdings = useMemo(() => allHoldings.filter((h) => isFinancialType(h.type)), [allHoldings]);
  const totalValue = useMemo(() => holdings.reduce((sum, h) => sum + (h.currentValue ?? 0), 0), [holdings]);

  const portfolioReturnSummary = useMemo(() => {
    const totalCapital = holdings.reduce((sum, h) => sum + (h.costOfCapital ?? 0), 0);
    const totalPnL = totalValue - totalCapital;
    const totalPnLPercent = totalCapital > 0 ? totalPnL / totalCapital : null;
    return {
      totalPnL,
      totalPnLPercent,
      xirrAnnual: portfolioXirrQuery.data?.xirrAnnual ?? null,
      xirrMonthly: portfolioXirrQuery.data?.xirrMonthly ?? null,
    };
  }, [holdings, totalValue, portfolioXirrQuery.data]);

  const chartData = useMemo(() =>
    [...(snapshots || [])]
      .sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime())
      .reduce((acc: ChartPoint[], snapshot) => {
        const dateKey = format(new Date(snapshot.snapshotAt), "dd/MM");
        const existing = acc.find((item) => item.date === dateKey);
        if (existing) {
          existing.totalValue = snapshot.totalValue;
          existing.stockValue = snapshot.stockValue;
          existing.goldValue = snapshot.goldValue;
        } else {
          acc.push({ date: dateKey, totalValue: snapshot.totalValue, stockValue: snapshot.stockValue, goldValue: snapshot.goldValue });
        }
        return acc;
      }, []),
    [snapshots]
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
    () => [...new Set(holdings.map((h) => h.type.toLowerCase()))].sort(),
    [holdings]
  );

  const filteredHoldings = useMemo(
    () => (filterType === "all" ? sortedHoldings : sortedHoldings.filter((h) => h.type.toLowerCase() === filterType)),
    [filterType, sortedHoldings]
  );

  const filteredTotal = useMemo(
    () => filteredHoldings.reduce((sum, h) => sum + (h.currentValue ?? 0), 0),
    [filteredHoldings]
  );

  const formatMoney = (value: number | null | undefined, full = false) =>
    hideValues ? "****" : full ? formatVNDFull(value) : formatVND(value);

  const sortLabel =
    sortOrder === "desc" ? "↓ High → Low" : sortOrder === "asc" ? "↑ Low → High" : "Sort";

  const cycleSortOrder = () => {
    setSortOrder((prev) => (prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"));
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
    const v = !showQtyCol;
    setShowQtyCol(v);
    localStorage.setItem("wealth_col_qty", v ? "1" : "0");
  };

  const togglePriceCol = () => {
    const v = !showPriceCol;
    setShowPriceCol(v);
    localStorage.setItem("wealth_col_price", v ? "1" : "0");
  };

  const handleExportCSV = () => {
    if (!holdings.length) return;
    const fmt = (v: number) => v.toLocaleString("vi-VN");
    const header = ["asset", "type", "current_value", "cost_of_capital"];
    const rows = holdings.map((h) => [
      h.symbol,
      formatTypeLabel(h.type),
      h.currentValue != null ? fmt(Math.round(h.currentValue)) : "",
      h.costOfCapital != null ? fmt(Math.round(h.costOfCapital)) : "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AssetsHeader
        title="WEALTH ALLOCATION"
        hasHoldings={holdings.length > 0}
        onExport={handleExportCSV}
      />

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 space-y-4">
        {isError ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Unable to load data."}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading...</div>
        ) : (
          <>
            <PortfolioSummaryCard
              title="Financial"
              totalValueLabel={formatMoney(totalValue, true)}
              hideValues={hideValues}
              onToggleHideValues={toggleHideValues}
              metrics={[
                {
                  label: "P/L",
                  value: formatVNDFull(portfolioReturnSummary.totalPnL),
                  tone: portfolioReturnSummary.totalPnL >= 0 ? "positive" : "negative",
                },
                {
                  label: "P/L %",
                  value: formatPercent(portfolioReturnSummary.totalPnLPercent),
                  tone: portfolioReturnSummary.totalPnLPercent == null ? "neutral" : portfolioReturnSummary.totalPnLPercent >= 0 ? "positive" : "negative",
                },
                {
                  label: "XIRR / Year",
                  value: formatPercent(portfolioReturnSummary.xirrAnnual),
                  tone: portfolioReturnSummary.xirrAnnual == null ? "neutral" : portfolioReturnSummary.xirrAnnual >= 0 ? "positive" : "negative",
                },
                {
                  label: "XIRR / Month",
                  value: formatPercent(portfolioReturnSummary.xirrMonthly),
                  tone: portfolioReturnSummary.xirrMonthly == null ? "neutral" : portfolioReturnSummary.xirrMonthly >= 0 ? "positive" : "negative",
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
