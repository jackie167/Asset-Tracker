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
    <header className="border-b border-border px-3 sm:px-4 md:px-6 py-3 sticky top-0 bg-background/95 backdrop-blur z-10">
      <div className="max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">Tài sản</h1>
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
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing} className="text-xs h-8">
            {isRefreshing ? "..." : "↻ Làm mới"}
          </Button>
          <Button variant="outline" size="sm" onClick={onExport} disabled={!hasHoldings} className="text-xs h-8">
            ↓ Export
          </Button>
          <Button variant="outline" size="sm" onClick={onImport} className="text-xs h-8">
            ↑ Import
          </Button>
          <Button size="sm" onClick={onAdd} className="text-xs h-8">
            + Thêm
          </Button>
        </div>
      </div>
    </header>
  );
}
