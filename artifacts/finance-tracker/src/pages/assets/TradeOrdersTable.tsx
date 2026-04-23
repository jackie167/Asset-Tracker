import { Card } from "@/components/ui/card";
import { formatVNDFull } from "@/pages/assets/utils";

export type TradeOrder = {
  id: number;
  side: "buy" | "sell";
  fundingSource: string;
  assetType: string;
  symbol: string;
  quantity: number;
  totalValue: number;
  unitPrice: number | null;
  note?: string | null;
  status: string;
  executedAt: string;
};

type TradeOrdersTableProps = {
  orders: TradeOrder[];
  isLoading: boolean;
  limit?: number;
  onEdit?: (order: TradeOrder) => void;
  onDelete?: (order: TradeOrder) => void;
};

export default function TradeOrdersTable({ orders, isLoading, limit = 10, onEdit, onDelete }: TradeOrdersTableProps) {
  const visibleOrders = limit > 0 ? orders.slice(0, limit) : orders;
  const hasActions = Boolean(onEdit || onDelete);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground uppercase tracking-widest">Trade Orders</p>
        {orders.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">{orders.length}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading trades...</p>
      ) : orders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No trade orders recorded yet.</p>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-[9px] text-muted-foreground uppercase tracking-wider border-b border-border">
                <th className="py-1.5 pr-3 text-left font-normal">Side</th>
                <th className="py-1.5 px-3 text-left font-normal">Asset</th>
                <th className="py-1.5 px-3 text-right font-normal">Qty</th>
                <th className="py-1.5 px-3 text-right font-normal">Total</th>
                <th className="py-1.5 px-3 text-left font-normal">Source</th>
                <th className="py-1.5 pl-3 text-right font-normal">Date</th>
                {hasActions && <th className="py-1.5 pl-3 text-right font-normal">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((order) => (
                <tr key={order.id} className="border-b border-border last:border-0">
                  <td className={`py-2 pr-3 font-semibold uppercase ${order.side === "buy" ? "text-emerald-400" : "text-amber-300"}`}>
                    {order.side}
                  </td>
                  <td className="py-2 px-3">
                    <div className="font-medium">{order.symbol}</div>
                    <div className="text-[10px] text-muted-foreground">{order.assetType}</div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                    {order.quantity.toLocaleString("vi-VN")}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium">
                    {formatVNDFull(order.totalValue)}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">{order.fundingSource}</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                    {new Date(order.executedAt).toLocaleDateString("vi-VN")}
                  </td>
                  {hasActions && (
                    <td className="py-2 pl-3 text-right whitespace-nowrap">
                      {onEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(order)}
                          className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Edit
                        </button>
                      )}
                      {onEdit && onDelete && <span className="mx-1.5 text-muted-foreground">·</span>}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(order)}
                          className="cursor-pointer text-[10px] font-medium text-destructive hover:text-destructive/80 transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
