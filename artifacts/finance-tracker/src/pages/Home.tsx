import { Link } from "wouter";
import { Card } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 bg-background z-10">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Home</h1>
          <p className="text-xs text-muted-foreground">Choose a workspace to start</p>
        </div>
      </header>

      <main className="w-full max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 space-y-4">
        <Card className="p-4 space-y-4 border-border/70 bg-gradient-to-br from-card via-card to-muted/40">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-[0.3em]">Asset Tracker</p>
            <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
              Asset control center
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-xl">
              Open Investment for tracked assets, Wealth Allocation for the full current asset sheet,
              or Excel Sheets for the source workbook.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Link href="/assets" className="block">
              <Card className="h-full border-border/70 bg-card/80 p-4 hover:border-primary/70 hover:shadow-[0_0_0_1px_hsl(var(--primary))] transition">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Page 1</p>
                <h3 className="mt-2 text-lg font-semibold">Investment</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Portfolio value, allocation, performance and synced holdings.
                </p>
                <div className="mt-3 text-xs font-semibold text-primary">Open page →</div>
              </Card>
            </Link>

            <Link href="/wealth-allocation" className="block">
              <Card className="h-full border-border/70 bg-card/80 p-4 hover:border-primary/70 hover:shadow-[0_0_0_1px_hsl(var(--primary))] transition">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Page 2</p>
                <h3 className="mt-2 text-lg font-semibold">Wealth Allocation</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Full current asset sheet grouped by Type.
                </p>
                <div className="mt-3 text-xs font-semibold text-primary">Open page →</div>
              </Card>
            </Link>

            <Link href="/excel" className="block">
              <Card className="h-full border-border/70 bg-card/80 p-4 hover:border-primary/70 hover:shadow-[0_0_0_1px_hsl(var(--primary))] transition">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Page 3</p>
                <h3 className="mt-2 text-lg font-semibold">Excel Sheets</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  View source sheets and sync Investment data.
                </p>
                <div className="mt-3 text-xs font-semibold text-primary">Open page →</div>
              </Card>
            </Link>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/80"></span>
            Total workspace: Home, Investment, Wealth Allocation, Excel Sheets.
          </div>
        </Card>
      </main>
    </div>
  );
}
