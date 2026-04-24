import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HoldingItem, SortOrder } from "@/pages/assets/types";
import { formatPercent, formatTypeLabel, formatTypeShortLabel, formatVNDFull } from "@/pages/assets/utils";

const RETURN_INITIAL_AT = new Date("2026-01-01T00:00:00.000Z");

function yearFraction(from: Date, to: Date) {
  return (to.getTime() - from.getTime()) / (365 * 24 * 60 * 60 * 1000);
}

function calculateSnapshotXirr(costOfCapital: number | null | undefined, currentValue: number | null | undefined) {
  if (costOfCapital == null || currentValue == null || costOfCapital <= 0 || currentValue <= 0) return null;
  const years = yearFraction(RETURN_INITIAL_AT, new Date());
  if (!Number.isFinite(years) || years <= 0) return null;
  return Math.pow(currentValue / costOfCapital, 1 / years) - 1;
}

type SortKey =
  | "symbol"
  | "type"
  | "weight"
  | "currentValue"
  | "quantity"
  | "currentPrice"
  | "costOfCapital"
  | "unrealizedPnL"
  | "unrealizedPnLPercent"
  | "xirrAnnual"
  | "xirrMonthly";

type SortDirection = "asc" | "desc";

function ChangeChip({
  change,
  changePercent,
}: {
  change: number | null | undefined;
  changePercent: number | null | undefined;
}) {
  if (change == null && changePercent == null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const isPositive = (change ?? 0) >= 0;
  return (
    <span className={`text-xs font-medium ${isPositive ? "text-green-400" : "text-red-400"}`}>
      {isPositive ? "▲" : "▼"} {changePercent != null ? `${Math.abs(changePercent).toFixed(2)}%` : ""}
    </span>
  );
}

type HoldingsTableProps = {
  holdings: HoldingItem[];
  filteredHoldings: HoldingItem[];
  totalValue: number;
  filteredTotal: number;
  filterType: string;
  availableTypes: string[];
  sortOrder: SortOrder;
  sortLabel: string;
  holdingsCollapsed: boolean;
  showQtyCol: boolean;
  showPriceCol: boolean;
  showCostOfCapitalCol?: boolean;
  showReturnCols?: boolean;
  cashAdjustedCost?: number | null;
  formatMoney: (value: number | null | undefined, full?: boolean) => string;
  onToggleHoldingsCollapsed: () => void;
  onToggleQtyCol: () => void;
  onTogglePriceCol: () => void;
  onToggleCostOfCapitalCol?: () => void;
  onFilterTypeChange: (value: string) => void;
  onCycleSortOrder: () => void;
  onAdd?: () => void;
  onEdit?: (holding: HoldingItem) => void;
  onDelete?: (id: number) => void;
  readOnly?: boolean;
};

export default function HoldingsTable({
  holdings,
  filteredHoldings,
  totalValue,
  filteredTotal,
  filterType,
  availableTypes,
  sortOrder,
  sortLabel,
  holdingsCollapsed,
  showQtyCol,
  showPriceCol,
  showCostOfCapitalCol = false,
  showReturnCols = false,
  cashAdjustedCost = null,
  formatMoney,
  onToggleHoldingsCollapsed,
  onToggleQtyCol,
  onTogglePriceCol,
  onToggleCostOfCapitalCol,
  onFilterTypeChange,
  onCycleSortOrder,
  onAdd,
  onEdit,
  onDelete,
  readOnly = false,
}: HoldingsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("currentValue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const filteredPnLTotal = filteredHoldings.reduce(
    (sum, holding) => sum + ((holding.currentValue ?? 0) - (holding.costOfCapital ?? 0)),
    0
  );

  const sortedFilteredHoldings = useMemo(() => {
    const denominator = filterType === "all" ? totalValue : filteredTotal;
    const rows = filteredHoldings.map((holding) => {
      const effectiveCostOfCapital =
        holding.type.trim().toLowerCase() === "cash" && cashAdjustedCost != null
          ? cashAdjustedCost
          : holding.costOfCapital;
      const unrealizedPnL =
        holding.currentValue != null && effectiveCostOfCapital != null
          ? holding.currentValue - effectiveCostOfCapital
          : null;
      const unrealizedPnLPercent =
        unrealizedPnL != null && (effectiveCostOfCapital ?? 0) > 0
          ? unrealizedPnL / (effectiveCostOfCapital ?? 0)
          : null;
      const xirrAnnual = calculateSnapshotXirr(effectiveCostOfCapital, holding.currentValue);
      const xirrMonthly = xirrAnnual == null ? null : Math.pow(1 + xirrAnnual, 1 / 12) - 1;
      const weight =
        denominator > 0 && holding.currentValue != null
          ? holding.currentValue / denominator
          : null;

      return {
        holding,
        unrealizedPnL,
        unrealizedPnLPercent,
        xirrAnnual,
        xirrMonthly,
        weight,
      };
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    return rows.sort((left, right) => {
      const normalizeText = (value: string) => value.trim().toLowerCase();

      if (sortKey === "symbol") {
        return left.holding.symbol.localeCompare(right.holding.symbol) * direction;
      }

      if (sortKey === "type") {
        return normalizeText(left.holding.type).localeCompare(normalizeText(right.holding.type)) * direction;
      }

      const resolveNumericValue = (row: typeof rows[number]) => {
        switch (sortKey) {
          case "weight":
            return row.weight;
          case "currentValue":
            return row.holding.currentValue;
          case "quantity":
            return row.holding.quantity;
          case "currentPrice":
            return row.holding.currentPrice;
          case "costOfCapital":
            return row.holding.costOfCapital;
          case "unrealizedPnL":
            return row.unrealizedPnL;
          case "unrealizedPnLPercent":
            return row.unrealizedPnLPercent;
          case "xirrAnnual":
            return row.xirrAnnual;
          case "xirrMonthly":
            return row.xirrMonthly;
          default:
            return Number.NEGATIVE_INFINITY;
        }
      };

      const leftValue = resolveNumericValue(left);
      const rightValue = resolveNumericValue(right);
      const normalizedLeft = typeof leftValue === "number" && Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
      const normalizedRight = typeof rightValue === "number" && Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;

      if (normalizedLeft !== normalizedRight) {
        return (normalizedLeft - normalizedRight) * direction;
      }

      return left.holding.symbol.localeCompare(right.holding.symbol);
    });
  }, [filteredHoldings, filterType, filteredTotal, sortDirection, sortKey, totalValue]);

  const filteredCostTotal = sortedFilteredHoldings.reduce((sum, row) => sum + (row.holding.costOfCapital ?? 0), 0);
  const colTemplate = [
    "minmax(108px, 1fr)",
    "minmax(84px, 0.72fr)",
    "minmax(48px, 0.5fr)",
    "minmax(118px, 1.05fr)",
    showQtyCol ? "minmax(52px, 0.58fr)" : null,
    showPriceCol ? "minmax(102px, 0.9fr)" : null,
    showCostOfCapitalCol ? "minmax(108px, 0.95fr)" : null,
    showReturnCols ? "minmax(112px, 0.95fr)" : null,
    showReturnCols ? "minmax(62px, 0.6fr)" : null,
    showReturnCols ? "minmax(72px, 0.65fr)" : null,
    showReturnCols ? "minmax(72px, 0.65fr)" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const totalColumns =
    4 +
    (showQtyCol ? 1 : 0) +
    (showPriceCol ? 1 : 0) +
    (showCostOfCapitalCol ? 1 : 0) +
    (showReturnCols ? 4 : 0);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "symbol" || key === "type" ? "asc" : "desc");
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleHoldingsCollapsed}
            className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors"
          >
            <span
              className="inline-block transition-transform duration-200"
              style={{ transform: holdingsCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            >
              ▾
            </span>
            Portfolio
            {holdings.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-normal">
                {holdings.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onToggleHoldingsCollapsed}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-label={holdingsCollapsed ? "Show portfolio" : "Hide portfolio"}
          >
            {holdingsCollapsed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {!holdingsCollapsed && holdings.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {[
              { label: "Qty", active: showQtyCol, onToggle: onToggleQtyCol },
              { label: "Price", active: showPriceCol, onToggle: onTogglePriceCol },
              onToggleCostOfCapitalCol
                ? { label: "Cost", active: showCostOfCapitalCol, onToggle: onToggleCostOfCapitalCol }
                : null,
            ].filter((item): item is { label: string; active: boolean; onToggle: () => void } => item !== null).map(({ label, active, onToggle }) => (
              <button
                key={label}
                onClick={onToggle}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  active
                    ? "border-border text-muted-foreground hover:border-primary/40"
                    : "border-dashed border-border/50 text-muted-foreground/40 line-through"
                }`}
                title={active ? `Hide ${label} column` : `Show ${label} column`}
              >
                {label}
              </button>
            ))}

            {availableTypes.length > 1 && (
              <Select value={filterType} onValueChange={onFilterTypeChange}>
                <SelectTrigger className="h-7 text-xs px-2 border-border gap-1 w-auto min-w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {availableTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {formatTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

          </div>
        )}
      </div>

      {!holdingsCollapsed && (
        <>
          {holdings.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No assets yet</p>
              {readOnly ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  This portfolio is synced from the Investment sheet.
                </p>
              ) : (
                <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}>
                  Add first asset
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-full" style={{ width: "max-content" }}>
                <div
                  className="grid gap-x-1 text-[9px] text-muted-foreground uppercase tracking-wider py-1.5 border-b border-border"
                  style={{ gridTemplateColumns: colTemplate }}
                >
                  <button type="button" onClick={() => handleSort("symbol")} className="text-left hover:text-foreground transition-colors">Asset{sortIndicator("symbol")}</button>
                  <button type="button" onClick={() => handleSort("type")} className="text-center hover:text-foreground transition-colors">Type{sortIndicator("type")}</button>
                  <button type="button" onClick={() => handleSort("weight")} className="text-right hover:text-foreground transition-colors">%{sortIndicator("weight")}</button>
                  <button type="button" onClick={() => handleSort("currentValue")} className="text-right whitespace-nowrap hover:text-foreground transition-colors">Total Value{sortIndicator("currentValue")}</button>
                  {showQtyCol && <button type="button" onClick={() => handleSort("quantity")} className="text-right hover:text-foreground transition-colors">Qty{sortIndicator("quantity")}</button>}
                  {showPriceCol && <button type="button" onClick={() => handleSort("currentPrice")} className="text-right hover:text-foreground transition-colors">Price{sortIndicator("currentPrice")}</button>}
                  {showCostOfCapitalCol && <button type="button" onClick={() => handleSort("costOfCapital")} className="text-right whitespace-nowrap hover:text-foreground transition-colors">Cost{sortIndicator("costOfCapital")}</button>}
                  {showReturnCols && <button type="button" onClick={() => handleSort("unrealizedPnL")} className="text-right whitespace-nowrap hover:text-foreground transition-colors">P/L{sortIndicator("unrealizedPnL")}</button>}
                  {showReturnCols && <button type="button" onClick={() => handleSort("unrealizedPnLPercent")} className="text-right whitespace-nowrap hover:text-foreground transition-colors">P/L %{sortIndicator("unrealizedPnLPercent")}</button>}
                  {showReturnCols && <button type="button" onClick={() => handleSort("xirrAnnual")} className="text-right whitespace-nowrap hover:text-foreground transition-colors">XIRR Year{sortIndicator("xirrAnnual")}</button>}
                  {showReturnCols && <button type="button" onClick={() => handleSort("xirrMonthly")} className="text-right whitespace-nowrap hover:text-foreground transition-colors">XIRR Month{sortIndicator("xirrMonthly")}</button>}
                </div>

                {filteredHoldings.length === 0 && filterType !== "all" && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No assets in this type.
                  </p>
                )}

                {sortedFilteredHoldings.map(({ holding, unrealizedPnL, unrealizedPnLPercent, xirrAnnual, xirrMonthly, weight }) => (
                  <div
                    key={holding.id}
                    className="grid gap-x-1 items-center py-2.5 border-b border-border last:border-0"
                    style={{ gridTemplateColumns: colTemplate }}
                  >
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium truncate">{holding.symbol}</p>
                      {!readOnly && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <ChangeChip change={holding.change} changePercent={holding.changePercent} />
                          <>
                            <button
                              onClick={() => onEdit?.(holding)}
                              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Edit
                            </button>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <button
                              onClick={() => onDelete?.(holding.id)}
                              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                            >
                              Delete
                            </button>
                          </>
                        </div>
                      )}
                    </div>

                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground text-center leading-snug truncate block">
                      {formatTypeShortLabel(holding.type)}
                    </span>

                    <span className="text-[10px] text-right tabular-nums text-muted-foreground">
                      {weight != null ? `${(weight * 100).toFixed(1)}%` : "—"}
                    </span>

                    <span className="text-sm font-semibold text-right tabular-nums whitespace-nowrap">
                      {formatMoney(holding.currentValue, true)}
                    </span>

                    {showQtyCol && (
                      <span className="text-[11px] text-right tabular-nums text-muted-foreground">
                        {holding.quantity.toLocaleString("vi-VN")}
                      </span>
                    )}

                    {showPriceCol && (
                      <span className="text-[11px] text-right tabular-nums text-muted-foreground">
                        {formatMoney(holding.currentPrice, true)}
                      </span>
                    )}

                    {showCostOfCapitalCol && (
                      <span className="text-[11px] text-right tabular-nums text-muted-foreground">
                        {formatMoney(holding.costOfCapital, true)}
                      </span>
                    )}

                    {showReturnCols && (
                      <span className={`text-[11px] text-right tabular-nums ${(unrealizedPnL ?? 0) >= 0 ? "text-emerald-400" : "text-red-300"}`}>
                        {formatVNDFull(unrealizedPnL)}
                      </span>
                    )}

                    {showReturnCols && (
                      <span className={`text-[11px] text-right tabular-nums ${
                        unrealizedPnLPercent == null
                          ? "text-muted-foreground"
                          : unrealizedPnLPercent >= 0
                            ? "text-emerald-400"
                            : "text-red-300"
                      }`}>
                        {formatPercent(unrealizedPnLPercent)}
                      </span>
                    )}

                    {showReturnCols && (
                      <span className={`text-[11px] text-right tabular-nums ${
                        xirrAnnual == null
                          ? "text-muted-foreground"
                          : xirrAnnual >= 0
                            ? "text-emerald-400"
                            : "text-red-300"
                      }`}>
                        {formatPercent(xirrAnnual)}
                      </span>
                    )}

                    {showReturnCols && (
                      <span className={`text-[11px] text-right tabular-nums ${
                        xirrMonthly == null
                          ? "text-muted-foreground"
                          : xirrMonthly >= 0
                            ? "text-emerald-400"
                            : "text-red-300"
                      }`}>
                        {formatPercent(xirrMonthly)}
                      </span>
                    )}
                  </div>
                ))}

                {filteredHoldings.length > 0 && (
                  <div
                    className="grid gap-x-1 items-center pt-2.5 mt-0.5"
                    style={{ gridTemplateColumns: colTemplate }}
                  >
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {filterType === "all"
                        ? "Portfolio Total"
                        : `${formatTypeLabel(filterType)} Total`}
                    </span>
                    <span />
                    <span className="text-sm font-bold text-right tabular-nums whitespace-nowrap text-muted-foreground">
                      {filteredHoldings.length > 0 ? "100.0%" : "—"}
                    </span>
                    <span className="text-sm font-bold text-right tabular-nums whitespace-nowrap text-primary">
                      {formatMoney(filteredTotal, true)}
                    </span>
                    {showQtyCol && <span />}
                    {showPriceCol && <span />}
                    {showCostOfCapitalCol && (
                      <span className="text-sm font-bold text-right tabular-nums whitespace-nowrap text-muted-foreground">
                        {formatMoney(filteredCostTotal, true)}
                      </span>
                    )}
                    {showReturnCols && (
                      <span className={`text-sm font-bold text-right tabular-nums whitespace-nowrap ${
                        filteredPnLTotal >= 0 ? "text-emerald-400" : "text-red-300"
                      }`}>
                        {formatVNDFull(filteredPnLTotal)}
                      </span>
                    )}
                    {showReturnCols && <span />}
                    {showReturnCols && <span />}
                    {showReturnCols && <span />}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
