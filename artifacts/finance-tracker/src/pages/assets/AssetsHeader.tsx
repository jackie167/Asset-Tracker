import { Link } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AssetsHeaderProps = {
  title?: string;
  lastUpdated?: string | null;
  hasHoldings: boolean;
  onExport: () => void;
  onTrade?: () => void;
  onImport?: () => void;
  onAdd?: () => void;
};

export default function AssetsHeader({
  title = "INVESTMENT",
  lastUpdated,
  hasHoldings,
  onExport,
  onTrade,
  onImport,
  onAdd,
}: AssetsHeaderProps) {
  return (
    <header className="border-b border-border px-3 sm:px-4 md:px-6 py-3 sticky top-0 bg-background/95 backdrop-blur z-10">
      <div className="max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold tracking-[0.18em]">{title}</h1>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Updated: {format(new Date(lastUpdated), "HH:mm dd/MM/yyyy")}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Menu
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href="/">Home</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/assets">Investment</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/wealth-allocation">Wealth Allocation</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/transactions">Transactions</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/excel">Excel</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard">Dashboard</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/fire">FIRE Planning</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {onTrade && (
              <DropdownMenuItem onSelect={onTrade}>
                Trade
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!hasHoldings} onSelect={onExport}>
              Export
            </DropdownMenuItem>
            {onImport && (
              <DropdownMenuItem onSelect={onImport}>
                Import
              </DropdownMenuItem>
            )}
            {onAdd && (
              <DropdownMenuItem onSelect={onAdd}>
                Add
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
