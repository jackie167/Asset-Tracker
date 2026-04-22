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
import { formatTypeLabel } from "@/pages/assets/utils";

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
  formatMoney: (value: number | null | undefined, full?: boolean) => string;
  onToggleHoldingsCollapsed: () => void;
  onToggleQtyCol: () => void;
  onTogglePriceCol: () => void;
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
  formatMoney,
  onToggleHoldingsCollapsed,
  onToggleQtyCol,
  onTogglePriceCol,
  onFilterTypeChange,
  onCycleSortOrder,
  onAdd,
  onEdit,
  onDelete,
  readOnly = false,
}: HoldingsTableProps) {
  const colTemplate = [
    "minmax(96px, 1.45fr)",
    "minmax(52px, 0.85fr)",
    showQtyCol ? "minmax(50px, 0.65fr)" : null,
    showPriceCol ? "minmax(64px, 0.9fr)" : null,
    "minmax(40px, 0.55fr)",
    "minmax(132px, 1.25fr)",
  ]
    .filter(Boolean)
    .join(" ");

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
            Danh mục
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
            aria-label={holdingsCollapsed ? "Hiện danh mục" : "Ẩn danh mục"}
          >
            {holdingsCollapsed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {!holdingsCollapsed && holdings.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {[
              { label: "SL", active: showQtyCol, onToggle: onToggleQtyCol },
              { label: "Giá", active: showPriceCol, onToggle: onTogglePriceCol },
            ].map(({ label, active, onToggle }) => (
              <button
                key={label}
                onClick={onToggle}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  active
                    ? "border-border text-muted-foreground hover:border-primary/40"
                    : "border-dashed border-border/50 text-muted-foreground/40 line-through"
                }`}
                title={active ? `Ẩn cột ${label}` : `Hiện cột ${label}`}
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
                  <SelectItem value="all">Tất cả</SelectItem>
                  {availableTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {formatTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {holdings.length > 1 && (
              <button
                onClick={onCycleSortOrder}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  sortOrder !== "none"
                    ? "border-primary/60 text-primary bg-primary/5"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {sortLabel}
              </button>
            )}
          </div>
        )}
      </div>

      {!holdingsCollapsed && (
        <>
          {holdings.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">Chưa có tài sản nào</p>
              {readOnly ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Danh mục này chỉ đồng bộ từ sheet Investment.
                </p>
              ) : (
                <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}>
                  Thêm tài sản đầu tiên
                </Button>
              )}
            </div>
          ) : (
            <div>
              <div
                className="grid gap-x-2 text-[9px] text-muted-foreground uppercase tracking-wider py-1.5 border-b border-border"
                style={{ gridTemplateColumns: colTemplate }}
              >
                <span>Tài sản</span>
                <span className="text-center">Loại</span>
                {showQtyCol && <span className="text-right">SL</span>}
                {showPriceCol && <span className="text-right">Giá</span>}
                <span className="text-right">%</span>
                <span className="text-right whitespace-nowrap">Tổng giá trị</span>
              </div>

              {filteredHoldings.length === 0 && filterType !== "all" && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Không có tài sản nào thuộc loại này.
                </p>
              )}

              {filteredHoldings.map((holding) => (
                <div
                  key={holding.id}
                  className="grid gap-x-2 items-center py-2.5 border-b border-border last:border-0"
                  style={{ gridTemplateColumns: colTemplate }}
                >
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate">{holding.symbol}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <ChangeChip change={holding.change} changePercent={holding.changePercent} />
                      {readOnly ? (
                        <span className="text-[10px] text-muted-foreground">Đồng bộ từ Investment</span>
                      ) : (
                        <>
                          <button
                            onClick={() => onEdit?.(holding)}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Sửa
                          </button>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <button
                            onClick={() => onDelete?.(holding.id)}
                            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                          >
                            Xóa
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground text-center leading-snug truncate block">
                    {holding.type === "stock" ? "CP" : holding.type === "gold" ? "Vàng" : holding.type}
                  </span>

                  {showQtyCol && (
                    <span className="text-[11px] text-right tabular-nums text-muted-foreground">
                      {holding.quantity.toLocaleString("vi-VN")}
                    </span>
                  )}

                  {showPriceCol && (
                    <span className="text-[11px] text-right tabular-nums text-muted-foreground">
                      {formatMoney(holding.currentPrice)}
                    </span>
                  )}

                  <span className="text-[10px] text-right tabular-nums text-muted-foreground">
                    {(filterType === "all" ? totalValue : filteredTotal) > 0 && holding.currentValue != null
                      ? `${(
                          (holding.currentValue / (filterType === "all" ? totalValue : filteredTotal)) *
                          100
                        ).toFixed(1)}%`
                      : "—"}
                  </span>

                  <span className="text-[11px] font-semibold text-right tabular-nums whitespace-nowrap">
                    {formatMoney(holding.currentValue, true)}
                  </span>
                </div>
              ))}

              {filteredHoldings.length > 0 && (
                <div
                  className="grid gap-x-2 items-center pt-2.5 mt-0.5"
                  style={{ gridTemplateColumns: colTemplate }}
                >
                  <span
                    className="text-[10px] text-muted-foreground uppercase tracking-wider"
                    style={{ gridColumn: `1 / ${3 + (showQtyCol ? 1 : 0) + (showPriceCol ? 1 : 0) + 1}` }}
                  >
                    {filterType === "all"
                      ? "Tổng danh mục"
                      : `Tổng ${
                          filterType === "stock"
                            ? "cổ phiếu"
                            : filterType === "gold"
                              ? "vàng"
                              : filterType === "crypto"
                                ? "crypto"
                                : filterType
                        }`}
                  </span>
                  <span className="text-sm font-bold text-right tabular-nums whitespace-nowrap text-primary">
                    {formatMoney(filteredTotal, true)}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
