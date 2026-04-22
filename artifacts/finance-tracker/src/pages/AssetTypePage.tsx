import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { usePortfolioData, usePortfolioMutations } from "@/hooks/use-portfolio";
import HoldingsTable from "@/pages/assets/HoldingsTable";
import PerformanceChart from "@/pages/assets/PerformanceChart";
import PortfolioSummaryCard from "@/pages/assets/PortfolioSummaryCard";
import type { ChartPoint, HoldingItem, SnapshotRange, SortOrder } from "@/pages/assets/types";
import { formatVND, formatVNDFull, formatTypeLabel } from "@/pages/assets/utils";

type RouteParams = {
  type: string;
};

export default function AssetTypePage() {
  const [, params] = useRoute<RouteParams>("/assets/type/:type");
  const [, navigate] = useLocation();
  const [snapshotRange, setSnapshotRange] = useState<SnapshotRange>("1m");
  const { summary, snapshots, holdings: holdingsFromApi, isLoading, isError, error } = usePortfolioData(snapshotRange);
  const { refreshPrices } = usePortfolioMutations();
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [holdingsCollapsed, setHoldingsCollapsed] = useState<boolean>(
    () => localStorage.getItem("holdings_collapsed") !== "0"
  );
  const [hideValues, setHideValues] = useState<boolean>(() => localStorage.getItem("hide_values") === "1");
  const [showQtyCol, setShowQtyCol] = useState<boolean>(() => localStorage.getItem("col_sl") !== "0");
  const [showPriceCol, setShowPriceCol] = useState<boolean>(() => localStorage.getItem("col_gia") !== "0");

  const normalizedType = (params?.type ?? "").toLowerCase();
  const holdings: HoldingItem[] = (summary?.holdings ?? holdingsFromApi) as HoldingItem[];
  const typeHoldings = useMemo(
    () => holdings.filter((holding) => holding.type.toLowerCase() === normalizedType),
    [holdings, normalizedType]
  );

  const sortedHoldings = useMemo(() => {
    if (sortOrder === "none") return typeHoldings;
    return [...typeHoldings].sort((a, b) => {
      const aValue = a.currentValue ?? 0;
      const bValue = b.currentValue ?? 0;
      return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [sortOrder, typeHoldings]);

  const totalValue = useMemo(
    () => typeHoldings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0),
    [typeHoldings]
  );

  const chartData = useMemo(() => {
    const points = [...(snapshots || [])]
      .sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime())
      .map((snapshot) => {
        const value =
          snapshot.typeValues?.[normalizedType] ??
          (normalizedType === "stock"
            ? snapshot.stockValue
            : normalizedType === "gold"
              ? snapshot.goldValue
              : null);

        if (value == null) return null;

        return {
          date: format(new Date(snapshot.snapshotAt), "dd/MM"),
          totalValue: value,
          stockValue: 0,
          goldValue: 0,
        } satisfies ChartPoint;
      })
      .filter((point): point is ChartPoint => point !== null);

    return points;
  }, [normalizedType, snapshots]);

  const supportsHistoricalChart = typeHoldings.length > 0;
  const typeLabel = normalizedType ? formatTypeLabel(normalizedType) : "Loại tài sản";
  const lastUpdated = summary?.lastUpdated;

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

  const handleRefresh = () => {
    refreshPrices.mutate();
  };

  const handleExportCSV = () => {
    if (!typeHoldings.length) return;
    const formatNumber = (value: number) => value.toLocaleString("vi-VN");
    const header = ["symbol", "type", "quantity", "current_price", "total_value"];
    const rows = typeHoldings.map((holding) => [
      holding.symbol,
      holding.type,
      holding.quantity != null ? formatNumber(holding.quantity) : "",
      holding.currentPrice != null ? formatNumber(holding.currentPrice) : "",
      holding.currentValue != null ? formatNumber(Math.round(holding.currentValue)) : "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `danh-muc-${normalizedType}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sortLabel =
    sortOrder === "desc" ? "↓ Cao → Thấp" : sortOrder === "asc" ? "↑ Thấp → Cao" : "Sắp xếp";

  const isMissingType = !isLoading && !isError && normalizedType !== "" && typeHoldings.length === 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-3 sm:px-4 md:px-6 py-3 sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight">{typeLabel}</h1>
              {lastUpdated && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Cập nhật: {format(new Date(lastUpdated), "HH:mm dd/MM/yyyy")}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Trang chính
              </Link>
              <Link href="/assets" className="hover:text-foreground transition-colors">
                Tài sản
              </Link>
              <Link href="/excel" className="hover:text-foreground transition-colors">
                Excel
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/assets")} className="text-xs h-8">
              ← Quay lại
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshPrices.isPending} className="text-xs h-8">
              {refreshPrices.isPending ? "..." : "↻ Làm mới"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!typeHoldings.length} className="text-xs h-8">
              ↓ Export
            </Button>
            <span className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
              Nguồn dữ liệu: Investment sheet
            </span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 space-y-4">
        {isError ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Không thể tải dữ liệu."}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Đang tải...</div>
        ) : isMissingType ? (
          <div className="rounded-lg border bg-card p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">Không tìm thấy loại tài sản này trong danh mục.</p>
            <Button variant="outline" size="sm" onClick={() => navigate("/assets")}>
              Quay lại trang tài sản
            </Button>
          </div>
        ) : (
          <>
            <PortfolioSummaryCard
              title={typeLabel}
              totalValueLabel={formatMoney(totalValue, true)}
              hideValues={hideValues}
              onToggleHideValues={toggleHideValues}
            />

            <PerformanceChart
              title="Biến động"
              seriesLabel=""
              chartData={supportsHistoricalChart ? chartData : []}
              hideValues={hideValues}
              selectedRange={snapshotRange}
              onRangeChange={setSnapshotRange}
              emptyMessage={
                supportsHistoricalChart
                  ? 'Chưa có dữ liệu lịch sử. Nhấn "Làm mới" để cập nhật giá.'
                  : "Hiện hệ thống chưa lưu lịch sử riêng theo loại tài sản này."
              }
            />

            <HoldingsTable
              holdings={typeHoldings}
              filteredHoldings={sortedHoldings}
              totalValue={totalValue}
              filteredTotal={totalValue}
              filterType="all"
              availableTypes={[]}
              sortOrder={sortOrder}
              sortLabel={sortLabel}
              holdingsCollapsed={holdingsCollapsed}
              showQtyCol={showQtyCol}
              showPriceCol={showPriceCol}
              formatMoney={formatMoney}
              onToggleHoldingsCollapsed={toggleHoldingsCollapsed}
              onToggleQtyCol={toggleQtyCol}
              onTogglePriceCol={togglePriceCol}
              onFilterTypeChange={() => {}}
              onCycleSortOrder={cycleSortOrder}
              readOnly
            />
          </>
        )}
      </main>
    </div>
  );
}
