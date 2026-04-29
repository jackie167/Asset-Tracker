import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AllocationChart from "@/pages/assets/AllocationChart";
import AssetsHeader from "@/pages/assets/AssetsHeader";
import HoldingsTable from "@/pages/assets/HoldingsTable";
import PerformanceChart from "@/pages/assets/PerformanceChart";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ChartPoint, HoldingItem, SnapshotRange, SortOrder } from "@/pages/assets/types";
import { formatTypeLabel, formatVND, formatVNDFull } from "@/pages/assets/utils";
import { fetchWealthAllocationHoldings } from "@/pages/wealthAllocationData";
import { fetchTotalAssetData, fetchTotalAssetRows, type TotalAssetRow } from "@/lib/excel-sheets";
import { useToast } from "@/hooks/use-toast";

export default function WealthAllocationPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
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
  const [debt, setDebt] = useState<number>(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWealthAllocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [wealthHoldings, totalAssetData, latestSnapshot] = await Promise.all([
        fetchWealthAllocationHoldings(),
        fetchTotalAssetData(),
        fetch("/api/wealth/snapshots/latest").then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      setHoldings(wealthHoldings);
      setDebt(totalAssetData?.debt ?? 0);
      if (latestSnapshot) setLastSavedAt(latestSnapshot.snapshotAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load wealth allocation.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loanRowsQuery = useQuery({ queryKey: ["excel-total-asset-rows"], queryFn: fetchTotalAssetRows });

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

  // ── Investment Growth Forecast ────────────────────────────────────────────
  const INVEST_TYPES = ["cash", "stock", "gold", "fund", "crypto", "bond"] as const;
  type InvestType = typeof INVEST_TYPES[number];
  const DEFAULT_RATES: Record<InvestType, number> = { cash: 4, stock: 15, gold: 8, fund: 9, crypto: 15, bond: 7 };
  const TYPE_LABELS: Record<InvestType, string> = { cash: "Cash", stock: "Stock", gold: "Gold", fund: "Fund", crypto: "Crypto", bond: "Bond" };

  const [growthRates, setGrowthRates] = useState<Record<InvestType, number>>(() => {
    const stored = localStorage.getItem("wealth_growth_rates");
    return stored ? { ...DEFAULT_RATES, ...JSON.parse(stored) } : DEFAULT_RATES;
  });

  const updateRate = (type: InvestType, value: number) => {
    const next = { ...growthRates, [type]: value };
    setGrowthRates(next);
    localStorage.setItem("wealth_growth_rates", JSON.stringify(next));
  };

  const investRows = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const h of holdings) {
      const t = h.type.toLowerCase();
      if (!INVEST_TYPES.includes(t as InvestType)) continue;
      grouped.set(t, (grouped.get(t) ?? 0) + (h.currentValue ?? 0));
    }
    return INVEST_TYPES
      .filter((t) => grouped.has(t))
      .map((t) => {
        const value = grouped.get(t) ?? 0;
        const rate = (growthRates[t] ?? DEFAULT_RATES[t]) / 100;
        const gain = value * rate;
        return { type: t, label: TYPE_LABELS[t], value, rate: growthRates[t] ?? DEFAULT_RATES[t], gain, projected: value + gain };
      });
  }, [holdings, growthRates]);

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

  const netAsset = totalValue - debt;

  const saveSnapshotMutation = useMutation({
    mutationFn: async () => {
      const body = {
        totalAsset: totalValue,
        debt,
        netAsset,
        items: holdings.map((h) => ({
          type: h.type,
          label: h.symbol,
          value: h.currentValue ?? 0,
        })).filter((i) => i.value > 0),
      };
      const res = await fetch("/api/wealth/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Unable to save snapshot.");
      return data as { snapshotAt: string };
    },
    onSuccess: (data) => {
      setLastSavedAt(data.snapshotAt);
      void queryClient.invalidateQueries({ queryKey: ["wealth-snapshots"] });
      toast({ title: "Đã lưu snapshot tài sản" });
    },
    onError: (err) => toast({ title: "Lỗi", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

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
        {error ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">{error}</div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading...</div>
        ) : (
          <>
            {/* ── Tổng quan tài sản ─────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Tổng tài sản", value: totalValue, color: "text-foreground" },
                { label: "Nợ", value: debt, color: debt > 0 ? "text-amber-400" : "text-muted-foreground" },
                { label: "Tài sản ròng", value: netAsset, color: netAsset >= 0 ? "text-emerald-400" : "text-red-400" },
              ].map((card) => (
                <Card key={card.label} className="p-4 space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{card.label}</p>
                  <p className={`text-sm sm:text-base md:text-lg font-bold tabular-nums break-all leading-snug ${card.color}`}>
                    {formatMoney(card.value, true)}
                  </p>
                </Card>
              ))}
            </div>

            {/* ── Save + last saved ─────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={toggleHideValues}
                className="text-[10px] text-muted-foreground hover:text-foreground uppercase tracking-widest transition-colors"
              >
                {hideValues ? "Hiện số liệu" : "Ẩn số liệu"}
              </button>
              <p className="text-[10px] text-muted-foreground">
                {lastSavedAt
                  ? `Lần lưu cuối: ${new Date(lastSavedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                  : "Chưa lưu snapshot nào"}
              </p>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={saveSnapshotMutation.isPending || totalValue === 0}
                onClick={() => saveSnapshotMutation.mutate()}
              >
                {saveSnapshotMutation.isPending ? "Đang lưu..." : "Lưu snapshot"}
              </Button>
            </div>

            {(totalValue > 0 || holdings.length > 0) && (
              <div className="grid md:grid-cols-2 gap-4">
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
              </div>
            )}

            {/* ── Dự báo Gia tăng Investment ───────────────────────── */}
            {investRows.length > 0 && (
              <section className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Dự báo Gia tăng Investment</p>
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-[9px] text-muted-foreground uppercase tracking-wider border-b border-border">
                          <th className="py-2 px-4 text-left font-normal">Tài sản</th>
                          <th className="py-2 px-4 text-right font-normal">Giá trị hiện tại</th>
                          <th className="py-2 px-4 text-right font-normal">% / năm</th>
                          <th className="py-2 px-4 text-right font-normal">Kỳ vọng tăng</th>
                          <th className="py-2 px-4 text-right font-normal">Dự báo cuối năm</th>
                        </tr>
                      </thead>
                      <tbody>
                        {investRows.map((row) => (
                          <tr key={row.type} className="border-b border-border last:border-0 hover:bg-muted/20">
                            <td className="py-2.5 px-4 font-medium">{row.label}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{formatMoney(row.value, true)}</td>
                            <td className="py-2.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  value={row.rate}
                                  onChange={(e) => updateRate(row.type as InvestType, Number(e.target.value))}
                                  className="w-16 rounded border border-border bg-background px-2 py-0.5 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <span className="text-muted-foreground">%</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-medium text-emerald-400">
                              +{formatMoney(row.gain, true)}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-semibold">
                              {formatMoney(row.projected, true)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border bg-muted/10">
                          <td className="py-2.5 px-4 font-bold">Tổng</td>
                          <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                            {formatMoney(investRows.reduce((s, r) => s + r.value, 0), true)}
                          </td>
                          <td />
                          <td className="py-2.5 px-4 text-right tabular-nums font-bold text-emerald-400">
                            +{formatMoney(investRows.reduce((s, r) => s + r.gain, 0), true)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                            {formatMoney(investRows.reduce((s, r) => s + r.projected, 0), true)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </section>
            )}

            {/* ── Theo dõi khoản vay ───────────────────────────────── */}
            {(() => {
              const rows: TotalAssetRow[] = loanRowsQuery.data ?? [];
              const debtRows = rows.filter((r, i, arr) =>
                r.debt > 0 || (arr[i - 1]?.debt ?? 0) > 0
              );
              if (!loanRowsQuery.isLoading && debtRows.length === 0) return null;
              return (
                <section className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Theo dõi khoản vay</p>
                  <Card className="overflow-hidden">
                    {loanRowsQuery.isLoading ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="text-[9px] text-muted-foreground uppercase tracking-wider border-b border-border">
                              <th className="py-2 px-4 text-left font-normal">Năm</th>
                              <th className="py-2 px-4 text-right font-normal">Nợ đầu năm</th>
                              <th className="py-2 px-4 text-right font-normal">Thanh toán</th>
                              <th className="py-2 px-4 text-right font-normal">Nợ cuối năm</th>
                            </tr>
                          </thead>
                          <tbody>
                            {debtRows.map((row, i, arr) => {
                              const prev = arr[i - 1];
                              const debtStart = prev?.debt ?? null;
                              const payment = debtStart != null ? Math.max(0, debtStart - row.debt) : null;
                              const isCurrentYear = row.year === new Date().getFullYear();
                              return (
                                <tr key={row.year} className={`border-b border-border last:border-0 ${isCurrentYear ? "bg-primary/5" : ""}`}>
                                  <td className={`py-2.5 px-4 font-semibold ${isCurrentYear ? "text-primary" : ""}`}>
                                    {row.year}{isCurrentYear && <span className="ml-1.5 text-[9px] text-primary/70 uppercase tracking-wider">hiện tại</span>}
                                  </td>
                                  <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">
                                    {debtStart != null ? formatMoney(debtStart, true) : "—"}
                                  </td>
                                  <td className={`py-2.5 px-4 text-right tabular-nums font-medium ${payment && payment > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                                    {payment != null && payment > 0 ? formatMoney(payment, true) : "—"}
                                  </td>
                                  <td className={`py-2.5 px-4 text-right tabular-nums font-semibold ${row.debt > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                                    {row.debt > 0 ? formatMoney(row.debt, true) : "Đã trả hết"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                </section>
              );
            })()}

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
