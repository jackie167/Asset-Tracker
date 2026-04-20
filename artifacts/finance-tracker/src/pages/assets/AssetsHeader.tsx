import { Link } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

type AssetsHeaderProps = {
  lastUpdated?: string | null;
  hasHoldings: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onImport: () => void;
  onAdd: () => void;
};

export default function AssetsHeader({
  lastUpdated,
  hasHoldings,
  isRefreshing,
  onRefresh,
  onExport,
  onImport,
  onAdd,
}: AssetsHeaderProps) {
  return (
    <header className="border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 bg-background z-10">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Tài sản</h1>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground">
            Cập nhật: {format(new Date(lastUpdated), "HH:mm dd/MM/yyyy")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Trang chính
        </Link>
        <Link href="/assets" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Tài sản
        </Link>
        <Link href="/excel" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Excel
        </Link>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing} className="text-xs">
          {isRefreshing ? "..." : "↻ Làm mới"}
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={!hasHoldings} className="text-xs">
          ↓ Export
        </Button>
        <Button variant="outline" size="sm" onClick={onImport} className="text-xs">
          ↑ Import
        </Button>
        <Button size="sm" onClick={onAdd} className="text-xs">
          + Thêm
        </Button>
      </div>
    </header>
  );
}
