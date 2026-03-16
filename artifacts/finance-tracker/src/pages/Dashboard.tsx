import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListHoldingsQueryKey, getGetPortfolioSummaryQueryKey, getListSnapshotsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { usePortfolioData, usePortfolioMutations } from "@/hooks/use-portfolio";
import ImportDialog from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

function formatVND(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} tỷ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} tr`;
  return value.toLocaleString("vi-VN") + " ₫";
}

function formatVNDFull(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("vi-VN") + " ₫";
}

const holdingSchema = z.object({
  type: z.string().min(1, "Bắt buộc"),
  symbol: z.string().min(1, "Bắt buộc"),
  quantity: z.coerce.number().positive("Số lượng phải > 0"),
  manualPrice: z.coerce.number().min(0).optional().nullable(),
});

type HoldingForm = z.infer<typeof holdingSchema>;

type HoldingItem = {
  id: number;
  type: string;
  symbol: string;
  quantity: number;
  currentPrice?: number | null;
  currentValue?: number | null;
  change?: number | null;
  changePercent?: number | null;
};

type SortOrder = "none" | "asc" | "desc";

const PIE_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(43, 96%, 56%)",
  "hsl(142, 71%, 45%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 60%)",
];

type TypeMode = "stock" | "gold" | "other";

function resolveMode(type: string): TypeMode {
  if (type === "stock") return "stock";
  if (type === "gold") return "gold";
  return "other";
}

function AddEditDialog({
  open,
  onClose,
  initialData,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: HoldingItem | null;
  onSubmit: (data: HoldingForm) => void;
  isLoading: boolean;
}) {
  const initialMode: TypeMode = initialData ? resolveMode(initialData.type) : "stock";
  const [typeMode, setTypeMode] = useState<TypeMode>(initialMode);

  const initialTotalValue = initialData?.currentValue
    ? String(Math.round(initialData.currentValue))
    : "";
  const [totalValueStr, setTotalValueStr] = useState(initialTotalValue);

  const form = useForm<HoldingForm>({
    resolver: zodResolver(holdingSchema),
    defaultValues: initialData
      ? { type: initialData.type, symbol: initialData.symbol, quantity: initialData.quantity, manualPrice: null }
      : { type: "stock", symbol: "", quantity: 0, manualPrice: null },
  });

  const watchType = form.watch("type");
  const watchQty = form.watch("quantity");

  const handleSubmit = form.handleSubmit((data) => {
    const raw = totalValueStr.replace(/\./g, "").replace(",", ".");
    const totalVal = parseFloat(raw);
    if (!isNaN(totalVal) && totalVal > 0 && data.quantity > 0) {
      data.manualPrice = totalVal / data.quantity;
    } else {
      data.manualPrice = null;
    }
    onSubmit(data);
  });

  const goldSymbols = [
    { value: "SJC_1L", label: "Vàng SJC 1 lượng" },
    { value: "SJC_1C", label: "Vàng SJC 1 chỉ" },
  ];

  const selectMode = (mode: TypeMode) => {
    if (!!initialData) return;
    setTypeMode(mode);
    if (mode === "stock") { form.setValue("type", "stock"); form.setValue("symbol", ""); }
    else if (mode === "gold") { form.setValue("type", "gold"); form.setValue("symbol", "SJC_1L"); }
    else { form.setValue("type", ""); form.setValue("symbol", ""); }
  };

  const btnClass = (active: boolean) =>
    `flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
      active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
    }`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initialData ? "Sửa tài sản" : "Thêm tài sản"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Loại tài sản</label>
            <div className="flex gap-2">
              <button type="button" disabled={!!initialData} onClick={() => selectMode("stock")} className={btnClass(typeMode === "stock")}>
                📈 Cổ phiếu
              </button>
              <button type="button" disabled={!!initialData} onClick={() => selectMode("gold")} className={btnClass(typeMode === "gold")}>
                🥇 Vàng
              </button>
              <button type="button" disabled={!!initialData} onClick={() => selectMode("other")} className={btnClass(typeMode === "other")}>
                ＋ Khác
              </button>
            </div>
          </div>

          {typeMode === "other" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Tên loại tài sản</label>
              <Input
                {...form.register("type")}
                placeholder="VD: Crypto, Bất động sản, Trái phiếu..."
                disabled={!!initialData}
              />
              {form.formState.errors.type && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.type.message}</p>
              )}
            </div>
          )}

          {typeMode === "stock" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Mã cổ phiếu</label>
              <Input
                {...form.register("symbol")}
                placeholder="VD: VNM, HPG, VIC"
                disabled={!!initialData}
                className="uppercase"
                onChange={(e) => form.setValue("symbol", e.target.value.toUpperCase())}
              />
              {form.formState.errors.symbol && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.symbol.message}</p>
              )}
            </div>
          )}

          {typeMode === "gold" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Loại vàng</label>
              <div className="flex flex-col gap-2">
                {goldSymbols.map((gs) => (
                  <button
                    key={gs.value}
                    type="button"
                    disabled={!!initialData}
                    onClick={() => form.setValue("symbol", gs.value)}
                    className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors text-left ${watchType === "gold" && form.watch("symbol") === gs.value ? "bg-primary/10 border-primary text-foreground" : "border-border text-muted-foreground hover:border-primary/50"}`}
                  >
                    {gs.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {typeMode === "other" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Tên / Mã tài sản</label>
              <Input
                {...form.register("symbol")}
                placeholder="VD: BTC, Căn hộ Q7, VNINDEX..."
                disabled={!!initialData}
              />
              {form.formState.errors.symbol && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.symbol.message}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                {typeMode === "stock" ? "Số lượng CP" : typeMode === "gold" ? "Số lượng" : "Số lượng"}
              </label>
              <Input
                {...form.register("quantity")}
                type="number"
                step="0.000001"
                placeholder="0"
              />
              {form.formState.errors.quantity && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.quantity.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                Giá trị tổng (₫)
                {watchQty > 0 && totalValueStr && (
                  <span className="ml-1 text-xs text-primary/70">
                    = {formatVND(parseFloat(totalValueStr.replace(/\./g, "").replace(",", ".")) / watchQty)}/đv
                  </span>
                )}
              </label>
              <Input
                value={totalValueStr}
                onChange={(e) => setTotalValueStr(e.target.value)}
                type="number"
                step="1000"
                placeholder="Tuỳ chọn"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Hủy
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Đang lưu..." : initialData ? "Cập nhật" : "Thêm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeChip({ change, changePercent }: { change: number | null | undefined; changePercent: number | null | undefined }) {
  if (change == null && changePercent == null) return <span className="text-muted-foreground text-xs">—</span>;
  const isPositive = (change ?? 0) >= 0;
  return (
    <span className={`text-xs font-medium ${isPositive ? "text-green-400" : "text-red-400"}`}>
      {isPositive ? "▲" : "▼"} {changePercent != null ? `${Math.abs(changePercent).toFixed(2)}%` : ""}
    </span>
  );
}

function AllocationChart({ stockValue, goldValue, totalValue }: { stockValue: number; goldValue: number; totalValue: number }) {
  const otherValue = Math.max(0, totalValue - stockValue - goldValue);
  const data = useMemo(() => {
    const items = [
      { name: "📈 Cổ phiếu", value: stockValue, pct: totalValue > 0 ? (stockValue / totalValue) * 100 : 0 },
      { name: "🥇 Vàng", value: goldValue, pct: totalValue > 0 ? (goldValue / totalValue) * 100 : 0 },
      { name: "📦 Khác", value: otherValue, pct: totalValue > 0 ? (otherValue / totalValue) * 100 : 0 },
    ].filter((d) => d.value > 0);
    return items;
  }, [stockValue, goldValue, otherValue, totalValue]);

  if (data.length === 0) return null;

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, index }: {
    cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; index: number;
  }) => {
    if (data[index].pct < 5) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
        {data[index].pct.toFixed(1)}%
      </text>
    );
  };

  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">Phân bổ tài sản</p>
      <div className="flex items-center gap-4">
        <div style={{ width: 180, height: 180, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={82}
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                label={renderCustomLabel}
                isAnimationActive={false}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, _name: string, props: { payload?: { name: string; pct: number } }) => [
                  `${formatVNDFull(value)} (${props.payload?.pct?.toFixed(1) ?? 0}%)`,
                  props.payload?.name ?? "",
                ]}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <ul className="flex flex-col gap-4 justify-center">
          {data.map((entry, i) => (
            <li key={entry.name} className="flex items-center gap-2.5">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <div>
                <p className="text-sm font-medium leading-tight">{entry.name}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.pct.toFixed(1)}% · {formatVND(entry.value)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { summary, snapshots, isLoading } = usePortfolioData();
  const { createHolding, updateHolding, deleteHolding, refreshPrices } = usePortfolioMutations();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editItem, setEditItem] = useState<HoldingItem | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("none");
  const [holdingsCollapsed, setHoldingsCollapsed] = useState(false);

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
  };

  const chartData = [...(snapshots || [])]
    .sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime())
    .reduce((acc: { date: string; totalValue: number; stockValue: number; goldValue: number }[], s) => {
      const dateKey = format(new Date(s.snapshotAt), "dd/MM");
      const existing = acc.find((d) => d.date === dateKey);
      if (existing) {
        existing.totalValue = s.totalValue;
        existing.stockValue = s.stockValue;
        existing.goldValue = s.goldValue;
      } else {
        acc.push({ date: dateKey, totalValue: s.totalValue, stockValue: s.stockValue, goldValue: s.goldValue });
      }
      return acc;
    }, []);

  const holdings: HoldingItem[] = summary?.holdings ?? [];
  const totalValue = summary?.totalValue ?? 0;
  const stockValue = summary?.stockValue ?? 0;
  const goldValue = summary?.goldValue ?? 0;
  const lastUpdated = summary?.lastUpdated;

  const sortedHoldings = useMemo(() => {
    if (sortOrder === "none") return holdings;
    return [...holdings].sort((a, b) => {
      const av = a.currentValue ?? 0;
      const bv = b.currentValue ?? 0;
      return sortOrder === "asc" ? av - bv : bv - av;
    });
  }, [holdings, sortOrder]);

  const cycleSortOrder = () => {
    setSortOrder((prev) => {
      if (prev === "none") return "desc";
      if (prev === "desc") return "asc";
      return "none";
    });
  };

  const sortLabel = sortOrder === "desc" ? "↓ Cao → Thấp" : sortOrder === "asc" ? "↑ Thấp → Cao" : "Sắp xếp";

  const handleAdd = (data: HoldingForm) => {
    createHolding.mutate({ data }, { onSuccess: () => setShowAdd(false) });
  };

  const handleEdit = (data: HoldingForm) => {
    if (!editItem) return;
    updateHolding.mutate({ id: editItem.id, data: { quantity: data.quantity } }, { onSuccess: () => setEditItem(null) });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Xóa tài sản này?")) return;
    deleteHolding.mutate({ id });
  };

  const handleRefresh = () => {
    refreshPrices.mutate({});
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshPrices.isPending}
            className="text-xs"
          >
            {refreshPrices.isPending ? "..." : "↻ Làm mới"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImport(true)}
            className="text-xs"
          >
            ↑ Import
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)} className="text-xs">
            + Thêm
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Đang tải...
          </div>
        ) : (
          <>
            <Card className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Tổng tài sản</p>
              <p className="text-3xl font-bold tracking-tight">{formatVNDFull(totalValue)}</p>
              <div className="flex gap-4 pt-1">
                <div>
                  <p className="text-xs text-muted-foreground">📈 Cổ phiếu</p>
                  <p className="text-sm font-medium">{formatVND(stockValue)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">🥇 Vàng</p>
                  <p className="text-sm font-medium">{formatVND(goldValue)}</p>
                </div>
              </div>
            </Card>

            {(stockValue > 0 || goldValue > 0) && (
              <AllocationChart stockValue={stockValue} goldValue={goldValue} totalValue={totalValue} />
            )}

            {chartData.length > 0 && (
              <Card className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">Biến động 7 ngày</p>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis
                      tickFormatter={(v) => formatVND(v)}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatVNDFull(value), "Tổng"]}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey="totalValue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorTotal)" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            )}

            {chartData.length === 0 && holdings.length > 0 && (
              <Card className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Biến động 7 ngày</p>
                <p className="text-sm text-muted-foreground text-center py-6">Chưa có dữ liệu lịch sử. Nhấn "Làm mới" để cập nhật giá.</p>
              </Card>
            )}

            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setHoldingsCollapsed((v) => !v)}
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

                {!holdingsCollapsed && holdings.length > 1 && (
                  <button
                    onClick={cycleSortOrder}
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

              {!holdingsCollapsed && (
                <>
                  {holdings.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground text-sm">Chưa có tài sản nào</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAdd(true)}>
                        Thêm tài sản đầu tiên
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sortedHoldings.map((h) => (
                        <div key={h.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{h.symbol}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {h.type === "stock" ? "CP" : h.type === "gold" ? "Vàng" : h.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {h.quantity.toLocaleString("vi-VN")} × {formatVND(h.currentPrice)}
                              </span>
                              <ChangeChip change={h.change} changePercent={h.changePercent} />
                            </div>
                          </div>
                          <div className="text-right ml-3 shrink-0">
                            <p className="text-sm font-semibold tabular-nums">{formatVNDFull(h.currentValue)}</p>
                            <div className="flex items-center gap-1 justify-end mt-0.5">
                              <button
                                onClick={() => setEditItem(h)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Sửa
                              </button>
                              <span className="text-muted-foreground text-xs">·</span>
                              <button
                                onClick={() => handleDelete(h.id)}
                                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                              >
                                Xóa
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Card>
          </>
        )}
      </main>

      <ImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={handleImportSuccess}
      />

      <AddEditDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
        isLoading={createHolding.isPending}
      />

      {editItem && (
        <AddEditDialog
          open={true}
          onClose={() => setEditItem(null)}
          initialData={editItem}
          onSubmit={handleEdit}
          isLoading={updateHolding.isPending}
        />
      )}
    </div>
  );
}
