import { useState, useMemo, useRef, useEffect } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const VND_INT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const VND_2 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

function formatVND(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `${VND_2.format(value / 1_000_000_000)} tỷ`;
  if (value >= 1_000_000) return `${VND_2.format(value / 1_000_000)} tr`;
  return VND_INT.format(value) + " ₫";
}

function formatVNDFull(value: number | null | undefined): string {
  if (value == null) return "—";
  return VND_INT.format(value) + " ₫";
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
  manualPrice?: number | null;
};

type SortOrder = "none" | "asc" | "desc";

const PIE_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(43, 96%, 56%)",
  "hsl(142, 71%, 45%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 60%)",
];

const CUSTOM_TYPES_KEY = "custom_asset_types";

function loadCustomTypes(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TYPES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomTypes(types: string[]): void {
  localStorage.setItem(CUSTOM_TYPES_KEY, JSON.stringify(types));
}

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
  allHoldings = [],
}: {
  open: boolean;
  onClose: () => void;
  initialData?: HoldingItem | null;
  onSubmit: (data: HoldingForm) => void;
  isLoading: boolean;
  allHoldings?: HoldingItem[];
}) {
  const initialMode: TypeMode = initialData ? resolveMode(initialData.type) : "stock";
  const [typeMode, setTypeMode] = useState<TypeMode>(initialMode);

  const BUILTIN_TYPES = ["stock", "gold", "crypto"];

  const [customTypes, setCustomTypes] = useState<string[]>(() => {
    const stored = loadCustomTypes().map((t) => t.toLowerCase());
    // Collect custom types from existing holdings (exclude all built-ins)
    const fromHoldings = allHoldings
      .map((h) => h.type.toLowerCase())
      .filter((t) => !BUILTIN_TYPES.includes(t));
    // Also include current editItem type if it's truly custom
    const fromEdit =
      initialData && !BUILTIN_TYPES.includes(initialData.type.toLowerCase())
        ? [initialData.type.toLowerCase()]
        : [];
    // Merge all sources, exclude built-ins, deduplicate with Set
    const merged = [...new Set([...stored, ...fromHoldings, ...fromEdit])]
      .filter((t) => !BUILTIN_TYPES.includes(t));
    saveCustomTypes(merged);
    return merged;
  });

  const [showNewInput, setShowNewInput] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const newTypeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNewInput) newTypeInputRef.current?.focus();
  }, [showNewInput]);

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

  // Reset form mỗi khi dialog Thêm mới được mở (không áp dụng cho Edit)
  useEffect(() => {
    if (open && !initialData) {
      form.reset({ type: "stock", symbol: "", quantity: 0, manualPrice: null });
      setTotalValueStr("");
      setTypeMode("stock");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const watchQty = form.watch("quantity");
  const watchSymbol = form.watch("symbol");

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

  const selectValue =
    typeMode === "stock" ? "stock"
    : typeMode === "gold" ? "gold"
    : form.getValues("type") || "";

  const handleTypeSelect = (value: string) => {
    if (value === "__add_new__") {
      setShowNewInput(true);
      return;
    }
    setShowNewInput(false);
    if (value === "stock") {
      setTypeMode("stock");
      form.setValue("type", "stock");
      if (!isEditing) form.setValue("symbol", "");
    } else if (value === "gold") {
      setTypeMode("gold");
      form.setValue("type", "gold");
      // In edit mode, only change symbol if it's not already a gold symbol
      const curSym = form.getValues("symbol");
      if (!isEditing) {
        form.setValue("symbol", "SJC_1L");
      } else if (!["SJC_1L", "SJC_1C"].includes(curSym)) {
        form.setValue("symbol", "SJC_1L");
      }
    } else {
      setTypeMode("other");
      form.setValue("type", value);
      if (!isEditing) form.setValue("symbol", "");
    }
  };

  const handleConfirmNewType = () => {
    const trimmed = newTypeName.trim().toLowerCase();
    if (!trimmed) return;
    // If user typed a built-in type name, just select it directly
    if (BUILTIN_TYPES.includes(trimmed)) {
      handleTypeSelect(trimmed);
      setShowNewInput(false);
      setNewTypeName("");
      return;
    }
    // Check if already exists in customTypes (case-insensitive) — if so just select it, don't duplicate
    const existing = customTypes.find((t) => t.toLowerCase() === trimmed);
    const finalType = existing ?? trimmed;
    const updated = existing ? customTypes : [...customTypes, trimmed];
    setCustomTypes(updated);
    saveCustomTypes(updated);
    setTypeMode("other");
    form.setValue("type", finalType);
    form.setValue("symbol", "");
    setShowNewInput(false);
    setNewTypeName("");
  };

  const typeLabel2 = (t: string) => {
    const name = t.charAt(0).toUpperCase() + t.slice(1);
    return `💼 ${name}`;
  };

  const isEditing = !!initialData;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Sửa tài sản" : "Thêm tài sản"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">

          {/* Loại tài sản — Select dropdown */}
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block">Loại tài sản</label>
            <Select value={selectValue} onValueChange={handleTypeSelect}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn loại tài sản..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stock">📈 Cổ phiếu</SelectItem>
                <SelectItem value="gold">🥇 Vàng</SelectItem>
                <SelectItem value="crypto">🪙 Crypto</SelectItem>
                {customTypes.filter((t) => t !== "crypto").map((t) => (
                  <SelectItem key={t} value={t}>{typeLabel2(t)}</SelectItem>
                ))}
                {!isEditing && (
                  <SelectItem value="__add_new__" className="text-primary">
                    ➕ Thêm loại mới...
                  </SelectItem>
                )}
              </SelectContent>
            </Select>

            {/* Custom types management — chips with delete button (Add mode only) */}
            {!isEditing && customTypes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customTypes.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
                  >
                    {typeLabel2(t)}
                    <button
                      type="button"
                      onClick={() => {
                        const updated = customTypes.filter((x) => x !== t);
                        setCustomTypes(updated);
                        saveCustomTypes(updated);
                        // If currently selected type is deleted, reset to stock
                        if (form.getValues("type") === t) {
                          handleTypeSelect("stock");
                        }
                      }}
                      className="text-destructive hover:text-destructive/80 font-bold leading-none ml-0.5"
                      title={`Xóa loại "${t}"`}
                    >
                      −
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Inline input for new type */}
            {showNewInput && (
              <div className="flex gap-2 mt-2">
                <Input
                  ref={newTypeInputRef}
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  placeholder="VD: Bất động sản, Trái phiếu..."
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleConfirmNewType(); } }}
                  className="flex-1"
                />
                <Button type="button" size="sm" onClick={handleConfirmNewType} disabled={!newTypeName.trim()}>
                  Lưu
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setShowNewInput(false); setNewTypeName(""); }}>
                  ✕
                </Button>
              </div>
            )}
          </div>

          {/* Mã cổ phiếu */}
          {typeMode === "stock" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Mã cổ phiếu</label>
              <Input
                {...form.register("symbol")}
                placeholder="VD: VNM, HPG, VIC"
                disabled={isEditing}
                className="uppercase"
                onChange={(e) => form.setValue("symbol", e.target.value.toUpperCase())}
              />
              {form.formState.errors.symbol && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.symbol.message}</p>
              )}
            </div>
          )}

          {/* Chọn loại vàng */}
          {typeMode === "gold" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Loại vàng</label>
              <div className="flex flex-col gap-2">
                {goldSymbols.map((gs) => (
                  <button
                    key={gs.value}
                    type="button"
                    onClick={() => form.setValue("symbol", gs.value)}
                    className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors text-left ${watchSymbol === gs.value ? "bg-primary/10 border-primary text-foreground" : "border-border text-muted-foreground hover:border-primary/50"}`}
                  >
                    {gs.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tên / Mã tài sản cho loại khác */}
          {typeMode === "other" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Tên / Mã tài sản</label>
              <Input
                {...form.register("symbol")}
                placeholder="VD: BTC, ETH, Căn hộ Q7..."
                disabled={isEditing}
                className="uppercase"
                onChange={(e) => form.setValue("symbol", e.target.value.toUpperCase())}
              />
              {form.formState.errors.symbol && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.symbol.message}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Số lượng</label>
              <Input
                {...form.register("quantity", { valueAsNumber: true })}
                type="number"
                step="any"
                min="0"
                placeholder="Nhập số lượng"
                onFocus={(e) => {
                  if (e.target.value === "0") {
                    e.target.value = "";
                  }
                }}
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
              {isLoading ? "Đang lưu..." : isEditing ? "Cập nhật" : "Thêm"}
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

function typeLabel(type: string) {
  if (type === "stock") return "📈 Cổ phiếu";
  if (type === "gold") return "🥇 Vàng";
  const name = type.charAt(0).toUpperCase() + type.slice(1);
  return `💼 ${name}`;
}

function AllocationChart({ holdings, totalValue }: { holdings: HoldingItem[]; totalValue: number }) {
  const data = useMemo(() => {
    const typeMap = new Map<string, number>();
    for (const h of (holdings ?? [])) {
      if (h.currentValue == null || h.currentValue <= 0) continue;
      const t = h.type.toLowerCase(); // normalize case to avoid duplicates
      typeMap.set(t, (typeMap.get(t) ?? 0) + h.currentValue);
    }
    const entries = Array.from(typeMap.entries()).sort(([a], [b]) => {
      if (a === "stock") return -1; if (b === "stock") return 1;
      if (a === "gold") return -1; if (b === "gold") return 1;
      return a.localeCompare(b);
    });
    return entries.map(([type, value]) => ({
      type,                          // raw normalized key
      name: typeLabel(type),
      value,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }));
  }, [holdings, totalValue]);

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
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Phân bổ tài sản</p>

      {/* Pie chart */}
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={72}
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

      {/* Table below pie */}
      <div
        className="grid gap-x-2 text-[9px] text-muted-foreground uppercase tracking-wider py-1.5 border-b border-border"
        style={{ gridTemplateColumns: "1fr 52px 1fr" }}
      >
        <span>Loại tài sản</span>
        <span className="text-center">Tỷ lệ</span>
        <span className="text-right">Giá trị</span>
      </div>

      {data.map((entry, i) => (
        <div
          key={entry.type}
          className="grid gap-x-2 items-center py-2.5 border-b border-border last:border-0"
          style={{ gridTemplateColumns: "1fr 52px 1fr" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
            />
            <span className="text-sm font-medium truncate">{entry.name}</span>
          </div>
          <span className="text-[11px] text-center tabular-nums font-medium">
            {entry.pct.toFixed(1)}%
          </span>
          <span className="text-[11px] font-semibold text-right tabular-nums whitespace-nowrap">
            {formatVNDFull(entry.value)}
          </span>
        </div>
      ))}
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
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [holdingsCollapsed, setHoldingsCollapsed] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [showQtyCol, setShowQtyCol] = useState<boolean>(() =>
    localStorage.getItem("col_sl") !== "0"
  );
  const [showPriceCol, setShowPriceCol] = useState<boolean>(() =>
    localStorage.getItem("col_gia") !== "0"
  );

  const colTemplate = [
    "96px",                          // Tài sản
    "42px",                          // Loại
    showQtyCol ? "50px" : null,      // SL
    showPriceCol ? "64px" : null,    // Giá
    "36px",                          // %
    "1fr",                           // Tổng giá trị
  ].filter(Boolean).join(" ");

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
  };

  const handleExportCSV = () => {
    if (!holdings.length) return;
    const header = ["symbol", "type", "quantity", "current_price"];
    const rows = holdings.map((h) => [
      h.symbol,
      h.type,
      h.quantity,
      h.currentPrice ?? "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `danh-muc-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  // Unique types from holdings for filter menu
  const availableTypes = useMemo(() => {
    const types = [...new Set(holdings.map((h) => h.type.toLowerCase()))];
    return types.sort((a, b) => {
      if (a === "stock") return -1; if (b === "stock") return 1;
      if (a === "gold") return -1; if (b === "gold") return 1;
      if (a === "crypto") return -1; if (b === "crypto") return 1;
      return a.localeCompare(b);
    });
  }, [holdings]);

  // Apply type filter on top of sorted list
  const filteredHoldings = useMemo(() =>
    filterType === "all" ? sortedHoldings : sortedHoldings.filter((h) => h.type.toLowerCase() === filterType),
  [sortedHoldings, filterType]);

  const filteredTotal = useMemo(() =>
    filteredHoldings.reduce((sum, h) => sum + (h.currentValue ?? 0), 0),
  [filteredHoldings]);

  const handleAdd = (data: HoldingForm) => {
    createHolding.mutate({ data }, { onSuccess: () => setShowAdd(false) });
  };

  const handleEdit = (data: HoldingForm) => {
    if (!editItem) return;
    updateHolding.mutate(
      { id: editItem.id, data: { type: data.type, quantity: data.quantity, manualPrice: data.manualPrice ?? null } },
      { onSuccess: () => setEditItem(null) }
    );
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
            onClick={handleExportCSV}
            disabled={!holdings.length}
            className="text-xs"
          >
            ↓ Export
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
              {(() => {
                const typeMap = new Map<string, number>();
                for (const h of holdings) {
                  if (h.currentValue == null || h.currentValue <= 0) continue;
                  typeMap.set(h.type, (typeMap.get(h.type) ?? 0) + h.currentValue);
                }
                const entries = Array.from(typeMap.entries()).sort(([a], [b]) => {
                  if (a === "stock") return -1; if (b === "stock") return 1;
                  if (a === "gold") return -1; if (b === "gold") return 1;
                  return a.localeCompare(b);
                });
                if (entries.length === 0) return null;
                return (
                  <div className="flex gap-4 pt-1 flex-wrap">
                    {entries.map(([type, value]) => (
                      <div key={type}>
                        <p className="text-xs text-muted-foreground">{typeLabel(type)}</p>
                        <p className="text-sm font-medium">{formatVND(value)}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>

            {totalValue > 0 && (
              <AllocationChart holdings={holdings} totalValue={totalValue} />
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

                {!holdingsCollapsed && holdings.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Column visibility toggles */}
                    {[
                      { label: "SL", active: showQtyCol, onToggle: () => { const v = !showQtyCol; setShowQtyCol(v); localStorage.setItem("col_sl", v ? "1" : "0"); } },
                      { label: "Giá", active: showPriceCol, onToggle: () => { const v = !showPriceCol; setShowPriceCol(v); localStorage.setItem("col_gia", v ? "1" : "0"); } },
                    ].map(({ label, active, onToggle }) => (
                      <button
                        key={label}
                        onClick={onToggle}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          active
                            ? "border-border text-muted-foreground hover:border-primary/40"
                            : "border-dashed border-border/50 text-muted-foreground/40 line-through"
                        }`}
                        title={active ? `Ẩn cột ${label}` : `Hiện cột ${label}`}
                      >
                        {label}
                      </button>
                    ))}

                    {/* Type filter */}
                    {availableTypes.length > 1 && (
                      <Select value={filterType} onValueChange={(v) => setFilterType(v)}>
                        <SelectTrigger className="h-7 text-xs px-2 border-border gap-1 w-auto min-w-[80px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Tất cả</SelectItem>
                          {availableTypes.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t === "stock" ? "📈 Cổ phiếu" : t === "gold" ? "🥇 Vàng" : t === "crypto" ? "🪙 Crypto" : `💼 ${t.charAt(0).toUpperCase() + t.slice(1)}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {/* Sort */}
                    {holdings.length > 1 && (
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
                    <div>
                      {/* Header row */}
                      <div
                        className="grid gap-x-1 text-[9px] text-muted-foreground uppercase tracking-wider py-1.5 border-b border-border"
                        style={{ gridTemplateColumns: colTemplate }}
                      >
                        <span>Tài sản</span>
                        <span className="text-center">Loại</span>
                        {showQtyCol && <span className="text-right">SL</span>}
                        {showPriceCol && <span className="text-right">Giá</span>}
                        <span className="text-right">%</span>
                        <span className="text-right whitespace-nowrap">Tổng giá trị</span>
                      </div>

                      {filteredHoldings.length === 0 && filterType !== "all" && (
                        <p className="text-sm text-muted-foreground text-center py-6">
                          Không có tài sản nào thuộc loại này.
                        </p>
                      )}

                      {filteredHoldings.map((h) => (
                        <div
                          key={h.id}
                          className="grid gap-x-1 items-center py-2.5 border-b border-border last:border-0"
                          style={{ gridTemplateColumns: colTemplate }}
                        >
                          {/* Tài sản + actions */}
                          <div className="overflow-hidden">
                            <p className="text-sm font-medium truncate">{h.symbol}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <ChangeChip change={h.change} changePercent={h.changePercent} />
                              <button
                                onClick={() => setEditItem(h)}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Sửa
                              </button>
                              <span className="text-[10px] text-muted-foreground">·</span>
                              <button
                                onClick={() => handleDelete(h.id)}
                                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                              >
                                Xóa
                              </button>
                            </div>
                          </div>

                          {/* Loại */}
                          <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground text-center leading-snug truncate block">
                            {h.type === "stock" ? "CP" : h.type === "gold" ? "Vàng" : h.type}
                          </span>

                          {/* Số lượng — ẩn/hiện */}
                          {showQtyCol && (
                            <span className="text-[11px] text-right tabular-nums text-muted-foreground">
                              {h.quantity.toLocaleString("vi-VN")}
                            </span>
                          )}

                          {/* Giá — ẩn/hiện */}
                          {showPriceCol && (
                            <span className="text-[11px] text-right tabular-nums text-muted-foreground">
                              {formatVND(h.currentPrice)}
                            </span>
                          )}

                          {/* Tỷ trọng % so với tổng danh mục */}
                          <span className="text-[10px] text-right tabular-nums text-muted-foreground">
                            {totalValue > 0 && h.currentValue != null
                              ? `${((h.currentValue / totalValue) * 100).toFixed(1)}%`
                              : "—"}
                          </span>

                          {/* Tổng giá trị — full format */}
                          <span className="text-[11px] font-semibold text-right tabular-nums whitespace-nowrap">
                            {formatVNDFull(h.currentValue)}
                          </span>
                        </div>
                      ))}

                      {/* Subtotal row */}
                      {filteredHoldings.length > 0 && (
                        <div
                          className="grid gap-x-1 items-center pt-2.5 mt-0.5"
                          style={{ gridTemplateColumns: colTemplate }}
                        >
                          <span
                            className="text-[10px] text-muted-foreground uppercase tracking-wider"
                            style={{ gridColumn: `1 / ${3 + (showQtyCol ? 1 : 0) + (showPriceCol ? 1 : 0) + 1}` }}
                          >
                            {filterType === "all" ? "Tổng danh mục" : `Tổng ${filterType === "stock" ? "cổ phiếu" : filterType === "gold" ? "vàng" : filterType === "crypto" ? "crypto" : filterType}`}
                          </span>
                          <span className="text-sm font-bold text-right tabular-nums whitespace-nowrap text-primary">
                            {formatVNDFull(filteredTotal)}
                          </span>
                        </div>
                      )}
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
        allHoldings={holdings}
      />

      {editItem && (
        <AddEditDialog
          open={true}
          onClose={() => setEditItem(null)}
          initialData={editItem}
          onSubmit={handleEdit}
          isLoading={updateHolding.isPending}
          allHoldings={holdings}
        />
      )}
    </div>
  );
}
