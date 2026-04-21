import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListHoldingsQueryKey,
  getGetPortfolioSummaryQueryKey,
  getListSnapshotsQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { usePortfolioData, usePortfolioMutations } from "@/hooks/use-portfolio";
import ImportDialog from "@/components/ImportDialog";
import AddEditDialog from "@/pages/assets/AddEditDialog";
import AllocationChart from "@/pages/assets/AllocationChart";
import AssetsHeader from "@/pages/assets/AssetsHeader";
import HoldingsTable from "@/pages/assets/HoldingsTable";
import PerformanceChart from "@/pages/assets/PerformanceChart";
import PortfolioSummaryCard from "@/pages/assets/PortfolioSummaryCard";
import type { ChartPoint, HoldingForm, HoldingItem, SnapshotRange, SortOrder } from "@/pages/assets/types";
import { formatVND, formatVNDFull } from "@/pages/assets/utils";

export default function AssetsPage() {
  const [, navigate] = useLocation();
  const [snapshotRange, setSnapshotRange] = useState<SnapshotRange>("1m");
  const { summary, snapshots, holdings: holdingsFromApi, isLoading, isError, error } = usePortfolioData(snapshotRange);
  const { createHolding, updateHolding, deleteHolding, refreshPrices } = usePortfolioMutations();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editItem, setEditItem] = useState<HoldingItem | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [holdingsCollapsed, setHoldingsCollapsed] = useState<boolean>(
    () => localStorage.getItem("holdings_collapsed") !== "0"
  );
  const [filterType, setFilterType] = useState<string>("all");
  const [hideValues, setHideValues] = useState<boolean>(() => localStorage.getItem("hide_values") === "1");
  const [showQtyCol, setShowQtyCol] = useState<boolean>(() => localStorage.getItem("col_sl") !== "0");
  const [showPriceCol, setShowPriceCol] = useState<boolean>(() => localStorage.getItem("col_gia") !== "0");

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

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
  };

  const handleExportCSV = () => {
    if (!holdings.length) return;
    const formatNumber = (value: number) => value.toLocaleString("vi-VN");
    const header = ["symbol", "type", "quantity", "current_price", "total_value"];
    const rows = holdings.map((holding) => [
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
    link.download = `danh-muc-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAdd = (data: HoldingForm) => {
    const existing = holdings.find(
      (holding) => holding.symbol.toLowerCase() === data.symbol.trim().toLowerCase()
    );
    if (existing) {
      const sameQty = data.quantity === existing.quantity;
      const nextQuantity = sameQty ? existing.quantity : existing.quantity + data.quantity;
      const nextManualPrice = data.manualPrice ?? existing.manualPrice ?? null;
      updateHolding.mutate(
        {
          id: existing.id,
          data: { type: data.type || existing.type, quantity: nextQuantity, manualPrice: nextManualPrice },
        },
        { onSuccess: () => setShowAdd(false) }
      );
      return;
    }
    createHolding.mutate({ data }, { onSuccess: () => setShowAdd(false) });
  };

  const handleEdit = (data: HoldingForm) => {
    if (!editItem) return;
    updateHolding.mutate(
      {
        id: editItem.id,
        data: { type: data.type, quantity: data.quantity, manualPrice: data.manualPrice ?? null },
      },
      { onSuccess: () => setEditItem(null) }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Xóa tài sản này?")) return;
    deleteHolding.mutate({ id });
  };

  const sortLabel =
    sortOrder === "desc" ? "↓ Cao → Thấp" : sortOrder === "asc" ? "↑ Thấp → Cao" : "Sắp xếp";

  const handleRefresh = () => {
    refreshPrices.mutate();
  };

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AssetsHeader
        lastUpdated={lastUpdated}
        hasHoldings={holdings.length > 0}
        isRefreshing={refreshPrices.isPending}
        onRefresh={handleRefresh}
        onExport={handleExportCSV}
        onImport={() => setShowImport(true)}
        onAdd={() => setShowAdd(true)}
      />

      <main className="w-full max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 space-y-4">
        {isError ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Không thể tải dữ liệu."}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Đang tải...
          </div>
        ) : (
          <>
            <PortfolioSummaryCard
              totalValueLabel={formatMoney(totalValue, true)}
              hideValues={hideValues}
              onToggleHideValues={toggleHideValues}
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
                title="Biến động"
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
              formatMoney={formatMoney}
              onToggleHoldingsCollapsed={toggleHoldingsCollapsed}
              onToggleQtyCol={toggleQtyCol}
              onTogglePriceCol={togglePriceCol}
              onFilterTypeChange={setFilterType}
              onCycleSortOrder={cycleSortOrder}
              onAdd={() => setShowAdd(true)}
              onEdit={setEditItem}
              onDelete={handleDelete}
            />
          </>
        )}
      </main>

      <ImportDialog open={showImport} onClose={() => setShowImport(false)} onSuccess={handleImportSuccess} />

      <AddEditDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
        isLoading={createHolding.isPending}
        allHoldings={holdings}
      />

      {editItem && (
        <AddEditDialog
          open={true}
          onClose={() => setEditItem(null)}
          initialData={editItem}
          onSubmit={handleEdit}
          isLoading={updateHolding.isPending}
          allHoldings={holdings}
        />
      )}
    </div>
  );
}
