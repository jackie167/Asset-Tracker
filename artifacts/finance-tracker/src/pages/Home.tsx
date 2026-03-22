import { Link } from "wouter";
import { Card } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 bg-background z-10">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Trang chính</h1>
          <p className="text-xs text-muted-foreground">Chọn khu vực để bắt đầu</p>
        </div>
      </header>

      <main className="w-full max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 space-y-4">
        <Card className="p-4 space-y-4 border-border/70 bg-gradient-to-br from-card via-card to-muted/40">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-[0.3em]">Asset Tracker</p>
            <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
              Trung tâm điều khiển tài sản
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-xl">
              Chọn nhanh khu vực bạn muốn xem. Tài sản dành cho tổng quan, phân bổ và danh mục.
              Excel Sheet dành cho bảng tính chi tiết.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Link href="/assets" className="block">
              <Card className="h-full border-border/70 bg-card/80 p-4 hover:border-primary/70 hover:shadow-[0_0_0_1px_hsl(var(--primary))] transition">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Page 1</p>
                <h3 className="mt-2 text-lg font-semibold">Tài sản</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Tổng tài sản, phân bổ, biến động và danh mục.
                </p>
                <div className="mt-3 text-xs font-semibold text-primary">Mở trang →</div>
              </Card>
            </Link>

            <Link href="/excel" className="block">
              <Card className="h-full border-border/70 bg-card/80 p-4 hover:border-primary/70 hover:shadow-[0_0_0_1px_hsl(var(--primary))] transition">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Page 2</p>
                <h3 className="mt-2 text-lg font-semibold">Excel Sheets</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Xem bảng tính, chỉnh nhanh ô không có công thức.
                </p>
                <div className="mt-3 text-xs font-semibold text-primary">Mở trang →</div>
              </Card>
            </Link>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/80"></span>
            Tổng thể gồm 3 trang: Trang chính, Tài sản, Excel Sheet.
          </div>
        </Card>
      </main>
    </div>
  );
}
