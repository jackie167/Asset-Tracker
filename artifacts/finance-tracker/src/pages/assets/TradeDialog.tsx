import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HoldingItem } from "@/pages/assets/types";
import { formatTypeLabel } from "@/pages/assets/utils";

type TradeDialogProps = {
  open: boolean;
  holdings: HoldingItem[];
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
  }) => void;
};

export default function TradeDialog({ open, holdings, isSaving, onClose, onSubmit }: TradeDialogProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [fundingSource, setFundingSource] = useState("CASH");
  const [assetType, setAssetType] = useState("stock");
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [totalValue, setTotalValue] = useState("");
  const [note, setNote] = useState("");

  const assetTypes = useMemo(
    () => [...new Set(holdings.map((holding) => holding.type.toLowerCase()))].sort(),
    [holdings]
  );
  const fundingSources = useMemo(
    () => holdings
      .filter((holding) => ["cash", "fund", "other"].includes(holding.type.toLowerCase()))
      .map((holding) => holding.symbol),
    [holdings]
  );

  useEffect(() => {
    if (!open) return;
    setSide("buy");
    setFundingSource(fundingSources[0] ?? "CASH");
    setAssetType(assetTypes[0] ?? "stock");
    setSymbol("");
    setQuantity("");
    setTotalValue("");
    setNote("");
  }, [assetTypes, fundingSources, open]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedTotalValue = Number(totalValue);
    if (!symbol.trim() || !fundingSource.trim() || !assetType.trim()) return;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return;
    if (!Number.isFinite(parsedTotalValue) || parsedTotalValue <= 0) return;

    onSubmit({
      side,
      fundingSource: fundingSource.trim(),
      assetType: assetType.trim(),
      symbol: symbol.trim(),
      quantity: parsedQuantity,
      totalValue: parsedTotalValue,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Trade</DialogTitle>
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
            <Input
              list="funding-sources"
              value={fundingSource}
              onChange={(event) => setFundingSource(event.target.value.toUpperCase())}
              placeholder="CASH"
            />
            <datalist id="funding-sources">
              {fundingSources.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Asset Type</label>
              <Input
                list="asset-types"
                value={assetType}
                onChange={(event) => setAssetType(event.target.value.toLowerCase())}
                placeholder="stock"
              />
              <datalist id="asset-types">
                {assetTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatTypeLabel(type)}
                  </option>
                ))}
              </datalist>
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
            <label className="text-sm text-muted-foreground mb-1 block">Note</label>
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Trade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
