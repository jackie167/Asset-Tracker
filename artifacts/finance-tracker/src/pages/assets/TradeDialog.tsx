import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HoldingItem } from "@/pages/assets/types";
import { formatTypeLabel } from "@/pages/assets/utils";
import type { TradeOrder } from "@/pages/assets/TradeOrdersTable";

type TradeDialogProps = {
  open: boolean;
  holdings: HoldingItem[];
  editingOrder?: TradeOrder | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (body: {
    side: "buy" | "sell";
    fundingSource: string;
    assetType: string;
    symbol: string;
    quantity: number;
    totalValue: number;
    note?: string;
    executedAt?: string;
  }) => void;
};

function formatDateInputValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export default function TradeDialog({ open, holdings, editingOrder, isSaving, onClose, onSubmit }: TradeDialogProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [assetType, setAssetType] = useState("stock");
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [totalValue, setTotalValue] = useState("");
  const [executedAt, setExecutedAt] = useState(formatDateInputValue(new Date()));
  const [note, setNote] = useState("");

  const assetTypes = useMemo(
    () => [...new Set(holdings.map((holding) => holding.type.toLowerCase()))].sort(),
    [holdings]
  );

  useEffect(() => {
    if (!open) return;
    if (editingOrder) {
      setSide(editingOrder.side);
      setAssetType(editingOrder.assetType);
      setSymbol(editingOrder.symbol);
      setQuantity(String(editingOrder.quantity));
      setTotalValue(String(editingOrder.totalValue));
      setExecutedAt(formatDateInputValue(editingOrder.executedAt));
      setNote(editingOrder.note ?? "");
      return;
    }
    setSide("buy");
    setAssetType(assetTypes[0] ?? "stock");
    setSymbol("");
    setQuantity("");
    setTotalValue("");
    setExecutedAt(formatDateInputValue(new Date()));
    setNote("");
  }, [assetTypes, editingOrder, open]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedTotalValue = Number(totalValue);
    if (!symbol.trim() || !assetType.trim()) return;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return;
    if (!Number.isFinite(parsedTotalValue) || parsedTotalValue <= 0) return;

    onSubmit({
      side,
      fundingSource: "CASH",
      assetType: assetType.trim(),
      symbol: symbol.trim(),
      quantity: parsedQuantity,
      totalValue: parsedTotalValue,
      note: note.trim() || undefined,
      executedAt,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingOrder ? "Edit Trade" : "Record Trade"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-2">
            {(["buy", "sell"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSide(value)}
                className={`rounded-md border px-3 py-2 text-sm font-medium uppercase transition-colors ${
                  side === value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Funding Source</label>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground">
              CASH
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Asset Type</label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                {assetTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {formatTypeLabel(type)}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Asset Symbol</label>
              <Input
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                placeholder="MWG"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Quantity</label>
              <Input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                type="number"
                min="0"
                step="any"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Total Value</label>
              <Input
                value={totalValue}
                onChange={(event) => setTotalValue(event.target.value)}
                type="number"
                min="0"
                step="1000"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Trade Date</label>
            <Input
              value={executedAt}
              onChange={(event) => setExecutedAt(event.target.value)}
              type="date"
            />
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Note</label>
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : editingOrder ? "Update Trade" : "Save Trade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
