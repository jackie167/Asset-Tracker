import { Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatTypeShortLabel, formatVNDFull } from "@/pages/assets/utils";

export type ProfitLossRow = {
  symbol: string;
  type: string;
  costOfCapital: number | null;
  currentValue: number | null;
  unrealizedPnL: number | null;
  unrealizedPnLPercent: number | null;
  xirrAnnual: number | null;
  xirrMonthly: number | null;
};

type ProfitLossTableProps = {
  rows: ProfitLossRow[];
  isLoading: boolean;
  error?: unknown;
  hideValues: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatMoney(value: number | null | undefined, hideValues: boolean) {
  if (hideValues) return "****";
  return formatVNDFull(value);
}

function typeRank(type: string) {
  const ranks: Record<string, number> = {
    stock: 0,
    gold: 1,
    crypto: 2,
  };
  return ranks[type.toLowerCase()] ?? 10;
}

export default function ProfitLossTable({
  rows,
  isLoading,
  error,
  hideValues,
  collapsed = false,
  onToggleCollapsed,
}: ProfitLossTableProps) {
  const sortedRows = [...rows].sort((a, b) => {
    const rankDiff = typeRank(a.type) - typeRank(b.type);
    if (rankDiff !== 0) return rankDiff;
    return a.symbol.localeCompare(b.symbol);
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors"
          >
            <span
              className="inline-block transition-transform duration-200"
              style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            >
              ▾
            </span>
            Profit & Loss
            {rows.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-normal">
                {rows.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-label={collapsed ? "Show profit and loss" : "Hide profit and loss"}
          >
            {collapsed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
      <p className="text-[11px] text-muted-foreground mb-3">
        Basic estimate: 01/01/2026 capital to current market value
      </p>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading returns...</p>
      ) : error ? (
        <p className="text-xs text-muted-foreground">
          {error instanceof Error ? error.message : "Unable to load returns."}
        </p>
      ) : sortedRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No return data yet.</p>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-[9px] text-muted-foreground uppercase tracking-wider border-b border-border">
                <th className="py-1.5 pr-3 text-left font-normal">Asset</th>
                <th className="py-1.5 px-3 text-center font-normal">Type</th>
                <th className="py-1.5 px-3 text-right font-normal">Capital</th>
                <th className="py-1.5 px-3 text-right font-normal">Current</th>
                <th className="py-1.5 px-3 text-right font-normal">P/L</th>
                <th className="py-1.5 px-3 text-right font-normal">P/L %</th>
                <th className="py-1.5 px-3 text-right font-normal">XIRR / Year</th>
                <th className="py-1.5 pl-3 text-right font-normal">XIRR / Month</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isPositive = (row.unrealizedPnL ?? 0) >= 0;
                return (
                  <tr key={`${row.type}-${row.symbol}`} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-medium">{row.symbol}</td>
                    <td className="py-2 px-3 text-center">
                      <span className="inline-block rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {formatTypeShortLabel(row.type)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {formatMoney(row.costOfCapital, hideValues)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {formatMoney(row.currentValue, hideValues)}
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums font-semibold ${isPositive ? "text-emerald-400" : "text-red-300"}`}>
                      {formatMoney(row.unrealizedPnL, hideValues)}
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums ${isPositive ? "text-emerald-400" : "text-red-300"}`}>
                      {formatPercent(row.unrealizedPnLPercent)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {formatPercent(row.xirrAnnual)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                      {formatPercent(row.xirrMonthly)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </Card>
  );
}
