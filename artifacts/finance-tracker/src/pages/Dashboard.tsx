import { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListHoldingsQueryKey, getGetPortfolioSummaryQueryKey, getListSnapshotsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
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
import { Eye, EyeOff } from "lucide-react";

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

  // Base custom types from DB (reactive — updates when allHoldings loads/changes)
  const baseCustomTypes = useMemo(() => {
    const fromHoldings = allHoldings
      .map((h) => h.type.toLowerCase())
      .filter((t) => !BUILTIN_TYPES.includes(t));
    const fromEdit =
      initialData && !BUILTIN_TYPES.includes(initialData.type.toLowerCase())
        ? [initialData.type.toLowerCase()]
        : [];
    return [...new Set([...fromHoldings, ...fromEdit])];
  }, [allHoldings, initialData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Types added in this session (not yet saved to DB)
  const [extraTypes, setExtraTypes] = useState<string[]>([]);

  // Combined final list
  const customTypes = useMemo(
    () => [...new Set([...baseCustomTypes, ...extraTypes])],
    [baseCustomTypes, extraTypes]
  );

  const setCustomTypes = (updater: string[] | ((prev: string[]) => string[])) => {
    // Only manage the extra (session) types; base comes from DB
    setExtraTypes((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Remove any that already exist in baseCustomTypes (no need to duplicate)
      return next.filter((t) => !baseCustomTypes.includes(t));
    });
  };

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

          {/* Loại tài sản — button group (tương thích mọi thiết bị) */}
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block">Loại tài sản</label>
            <div className="flex flex-wrap gap-1.5">
              {/* Built-in types */}
              {[
                { value: "stock", label: "📈 Cổ phiếu" },
                { value: "gold",  label: "🥇 Vàng" },
                { value: "crypto", label: "🪙 Crypto" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleTypeSelect(value)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    selectValue === value
                      ? "bg-primary/10 border-primary text-foreground font-medium"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}

              {/* Custom type buttons */}
              {customTypes.filter((t) => t !== "crypto").map((t) => (
                <span key={t} className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => handleTypeSelect(t)}
                    className={`px-3 py-1.5 rounded-l-md text-sm border-y border-l transition-colors ${
                      selectValue === t
                        ? "bg-primary/10 border-primary text-foreground font-medium"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {typeLabel2(t)}
                  </button>
                  {/* Delete button — chỉ hiện cho loại mới thêm trong session, không phải từ DB */}
                  {!isEditing && extraTypes.includes(t) && (
                    <button
                      type="button"
                      onClick={() => {
                        setExtraTypes((prev) => prev.filter((x) => x !== t));
                        if (form.getValues("type") === t) handleTypeSelect("stock");
                      }}
                      className={`px-1.5 py-1.5 rounded-r-md text-sm border-y border-r transition-colors text-destructive hover:bg-destructive/10 ${
                        selectValue === t ? "border-primary" : "border-border"
                      }`}
                      title={`Xóa loại "${t}"`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}

              {/* Thêm loại mới — chỉ hiện ở Add mode */}
              {!isEditing && !showNewInput && (
                <button
                  type="button"
                  onClick={() => setShowNewInput(true)}
                  className="px-3 py-1.5 rounded-md text-sm border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                >
                  + Thêm
                </button>
              )}
            </div>

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
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const data = useMemo(() => {
    const typeMap = new Map<string, number>();
    for (const h of (holdings ?? [])) {
      if (h.currentValue == null || h.currentValue <= 0) continue;
      const t = h.type.toLowerCase();
      typeMap.set(t, (typeMap.get(t) ?? 0) + h.currentValue);
    }
    const entries = Array.from(typeMap.entries());
    entries.sort(([, a], [, b]) => sortDir === "desc" ? b - a : a - b);
    return entries.map(([type, value], i) => ({
      type,
      name: typeLabel(type),
      value,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [holdings, totalValue, sortDir]);

  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      {/* Header + sort buttons */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground uppercase tracking-widest">Phân bổ tài sản</p>
        <div className="flex gap-1">
          <button
            onClick={() => setSortDir("desc")}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              sortDir === "desc"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            Cao → Thấp
          </button>
          <button
            onClick={() => setSortDir("asc")}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              sortDir === "asc"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            Thấp → Cao
          </button>
        </div>
      </div>

      {/* Bar chart — fixed width per bar, centered */}
      {(() => {
        const BAR_W = 48;
        const BAR_GAP = 28;
        const chartW = data.length * (BAR_W + BAR_GAP) + 40;
        return (
          <div style={{ height: 160 }} className="flex justify-center overflow-x-auto">
            <BarChart
              width={chartW}
              height={160}
              data={data}
              barSize={BAR_W}
              barCategoryGap={BAR_GAP}
              margin={{ top: 18, right: 20, left: 20, bottom: 0 }}
            >
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                formatter={(value: number, _name: string, props: { payload?: { name: string; pct: number } }) => [
                  `${formatVND(value)} (${props.payload?.pct?.toFixed(1) ?? 0}%)`,
                  props.payload?.name ?? "",
                ]}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList
                  dataKey="pct"
                  position="top"
                  style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  formatter={(v: number) => `${v.toFixed(1)}%`}
                />
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </div>
        );
      })()}

      {/* Table — compact, centered */}
      <div className="flex justify-center mt-1">
      <table style={{ borderCollapse: "collapse", display: "inline-table" }}>
        <thead>
          <tr className="text-[9px] text-muted-foreground uppercase tracking-wider">
            <th className="py-1.5 pr-6 text-left font-normal border-b border-border">Loại tài sản</th>
            <th className="py-1.5 px-4 text-center font-normal border-b border-border">Tỷ lệ</th>
            <th className="py-1.5 pl-6 text-right font-normal border-b border-border">Giá trị</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry, idx) => (
            <tr key={entry.type} className={idx < data.length - 1 ? "border-b border-border" : ""}>
              <td className="py-2.5 pr-6">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.color }} />
                  <span className="text-sm font-medium whitespace-nowrap">{entry.name}</span>
                </div>
              </td>
              <td className="py-2.5 px-4 text-[11px] text-center tabular-nums font-medium">
                {entry.pct.toFixed(1)}%
              </td>
              <td className="py-2.5 pl-6 text-[11px] font-semibold text-right tabular-nums whitespace-nowrap">
                {formatVND(entry.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

type DashboardMode = "assets" | "excel";

export default function Dashboard({ mode = "assets" }: { mode?: DashboardMode }) {
  const showAssets = mode !== "excel";
  const showExcel = mode !== "assets";
  const { summary, snapshots, holdings: holdingsFromApi, isLoading, isError, error } = usePortfolioData();
  const { createHolding, updateHolding, deleteHolding, refreshPrices } = usePortfolioMutations();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editItem, setEditItem] = useState<HoldingItem | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [holdingsCollapsed, setHoldingsCollapsed] = useState<boolean>(() =>
    localStorage.getItem("holdings_collapsed") !== "0"
  );
  const [filterType, setFilterType] = useState<string>("all");
  const [hideValues, setHideValues] = useState<boolean>(() =>
    localStorage.getItem("hide_values") === "1"
  );
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [excelSheet, setExcelSheet] = useState<string>("");
  const [excelRows, setExcelRows] = useState<Array<Array<string | number>>>([]);
  const [excelFormulas, setExcelFormulas] = useState<Array<Array<boolean>>>([]);
  const [excelDebug, setExcelDebug] = useState(false);
  const [excelFormulaText, setExcelFormulaText] = useState<Array<Array<string>>>([]);
  const [excelErrors, setExcelErrors] = useState<Array<Array<string>>>([]);
  const [excelEdit, setExcelEdit] = useState<{ row: number; col: number; value: string } | null>(null);
  const [excelOverrides, setExcelOverrides] = useState<Record<string, string | number | null>>({});
  const [excelUploading, setExcelUploading] = useState(false);
  const excelFileRef = useRef<HTMLInputElement | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
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
    const fmtNum = (v: number) => v.toLocaleString("vi-VN");
    const header = ["symbol", "type", "quantity", "current_price", "total_value"];
    const rows = holdings.map((h) => [
      h.symbol,
      h.type,
      h.quantity != null ? fmtNum(h.quantity) : "",
      h.currentPrice != null ? fmtNum(h.currentPrice) : "",
      h.currentValue != null ? fmtNum(Math.round(h.currentValue)) : "",
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

  const holdings: HoldingItem[] = (summary?.holdings ?? holdingsFromApi) as HoldingItem[];
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
  const formatMoney = (value: number | null | undefined, full = false) =>
    hideValues ? "****" : full ? formatVNDFull(value) : formatVND(value);
  const formatExcelNumber = (value: number) =>
    value.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const loadExcelSheets = async () => {
    setExcelError(null);
    setExcelLoading(true);
    try {
      const res = await fetch("/api/excel/sheets");
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể tải danh sách sheet.");
      const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
      setExcelSheets(sheets);
      if (sheets.length && !excelSheet) {
        setExcelSheet(sheets[0]);
      }
    } catch (err) {
      setExcelError(err instanceof Error ? err.message : "Không thể tải danh sách sheet.");
    } finally {
      setExcelLoading(false);
    }
  };

  const loadExcelSheet = async (name: string) => {
    if (!name) return;
    setExcelError(null);
    setExcelLoading(true);
    try {
      const debugParam = excelDebug ? "&debug=1" : "";
      const res = await fetch(`/api/excel/sheet?name=${encodeURIComponent(name)}${debugParam}`);
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể tải dữ liệu sheet.");
      setExcelRows(Array.isArray(data?.rows) ? data.rows : []);
      setExcelFormulas(Array.isArray(data?.formulas) ? data.formulas : []);
      if (excelDebug && data?.debug) {
        setExcelFormulaText(Array.isArray(data?.debug?.formulaText) ? data.debug.formulaText : []);
        setExcelErrors(Array.isArray(data?.debug?.errors) ? data.debug.errors : []);
      } else {
        setExcelFormulaText([]);
        setExcelErrors([]);
      }
    } catch (err) {
      setExcelError(err instanceof Error ? err.message : "Không thể tải dữ liệu sheet.");
    } finally {
      setExcelLoading(false);
    }
  };

  const handleExcelUpload = async (file: File) => {
    setExcelError(null);
    setExcelUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/excel/upload", { method: "POST", body: form });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể upload file Excel.");
      const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
      setExcelSheets(sheets);
      if (sheets.length) {
        setExcelSheet(sheets[0]);
      } else {
        setExcelSheet("");
        setExcelRows([]);
        setExcelFormulas([]);
      }
    } catch (err) {
      setExcelError(err instanceof Error ? err.message : "Không thể upload file Excel.");
    } finally {
      setExcelUploading(false);
      if (excelFileRef.current) excelFileRef.current.value = "";
    }
  };

  const recalcExcelSheet = async (name: string, overrides: Record<string, string | number | null>) => {
    setExcelError(null);
    setExcelLoading(true);
    try {
      const res = await fetch("/api/excel/sheet/recalc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, overrides }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể tính lại dữ liệu sheet.");
      setExcelRows(Array.isArray(data?.rows) ? data.rows : []);
      setExcelFormulas(Array.isArray(data?.formulas) ? data.formulas : []);
    } catch (err) {
      setExcelError(err instanceof Error ? err.message : "Không thể tính lại dữ liệu sheet.");
    } finally {
      setExcelLoading(false);
    }
  };

  const startExcelEdit = (row: number, col: number, value: string) => {
    setExcelEdit({ row, col, value });
  };

  const commitExcelEdit = () => {
    if (!excelEdit) return;
    const { row, col, value } = excelEdit;
    const trimmed = value.trim();
    const parsed =
      trimmed === ""
        ? null
        : (() => {
            const num = Number(trimmed.replace(/,/g, ""));
            return Number.isFinite(num) && trimmed.match(/^[-+]?[\d,.]+$/) ? num : trimmed;
          })();
    const key = `${row},${col}`;
    const nextOverrides = { ...excelOverrides, [key]: parsed };
    setExcelOverrides(nextOverrides);
    if (excelSheet) {
      recalcExcelSheet(excelSheet, nextOverrides);
    }
    setExcelEdit(null);
  };

  const toggleHoldingsCollapsed = () => {
    const next = !holdingsCollapsed;
    setHoldingsCollapsed(next);
    localStorage.setItem("holdings_collapsed", next ? "1" : "0");
  };

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
    const existing = holdings.find(
      (h) => h.symbol.toLowerCase() === data.symbol.trim().toLowerCase()
    );
    if (existing) {
      const sameQty = data.quantity === existing.quantity;
      const nextQuantity = sameQty ? existing.quantity : existing.quantity + data.quantity;
      const nextManualPrice = data.manualPrice ?? existing.manualPrice ?? null;
      updateHolding.mutate(
        { id: existing.id, data: { type: data.type || existing.type, quantity: nextQuantity, manualPrice: nextManualPrice } },
        { onSuccess: () => setShowAdd(false) }
      );
      return;
    }
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

  const readJsonSafe = async (res: Response) => {
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(text?.slice(0, 120) || "Phản hồi không hợp lệ.");
    }
    return res.json();
  };

  useEffect(() => {
    if (showExcel) {
      loadExcelSheets();
    }
  }, [showExcel]);

  useEffect(() => {
    if (!showExcel) return;
    if (excelSheet) {
      setExcelOverrides({});
      loadExcelSheet(excelSheet);
    }
  }, [excelSheet, excelDebug, showExcel]);

  const handleRefresh = () => {
    refreshPrices.mutate({});
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 bg-background z-10">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {showAssets ? "Tài sản" : "Excel Sheets"}
          </h1>
          {showAssets && lastUpdated && (
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
          {showAssets && (
            <>
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
            </>
          )}
        </div>
      </header>

      <main className="w-full max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 space-y-4">
        {showAssets && (
          isError ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              {error instanceof Error ? error.message : "Không thể tải dữ liệu."}
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Đang tải...
            </div>
          ) : (
            <>
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Tổng tài sản</p>
                <button
                  type="button"
                  onClick={() => {
                    const next = !hideValues;
                    setHideValues(next);
                    localStorage.setItem("hide_values", next ? "1" : "0");
                  }}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={hideValues ? "Hiện giá trị" : "Ẩn giá trị"}
                >
                  {hideValues ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-3xl font-bold tracking-tight">{formatMoney(totalValue, true)}</p>
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
                      tickFormatter={(v) => (hideValues ? "" : formatVND(v))}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <Tooltip
                      formatter={(value: number) => [hideValues ? "****" : formatVNDFull(value), "Tổng"]}
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleHoldingsCollapsed}
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
                  <button
                    type="button"
                    onClick={toggleHoldingsCollapsed}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={holdingsCollapsed ? "Hiện danh mục" : "Ẩn danh mục"}
                  >
                    {holdingsCollapsed ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

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
                              {formatMoney(h.currentPrice)}
                            </span>
                          )}

                          {/* Tỷ trọng % theo tổng đang lọc */}
                          <span className="text-[10px] text-right tabular-nums text-muted-foreground">
                            {((filterType === "all" ? totalValue : filteredTotal) > 0) && h.currentValue != null
                              ? `${((h.currentValue / (filterType === "all" ? totalValue : filteredTotal)) * 100).toFixed(1)}%`
                              : "—"}
                          </span>

                          {/* Tổng giá trị — full format */}
                          <span className="text-[11px] font-semibold text-right tabular-nums whitespace-nowrap">
                            {formatMoney(h.currentValue, true)}
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
                            {formatMoney(filteredTotal, true)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </Card>
          </>
        ))}

        {showExcel && (
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Excel Sheets</p>
                <p className="text-xs text-muted-foreground">Chọn sheet để xem dạng bảng</p>
              </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={excelFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleExcelUpload(f);
                    }}
                  />
                  <button
                    onClick={() => excelFileRef.current?.click()}
                    className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:border-primary/40"
                    disabled={excelUploading}
                  >
                    {excelUploading ? "Đang import..." : "Import file"}
                  </button>
                  <button
                    onClick={() => setExcelDebug((prev) => !prev)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      excelDebug
                        ? "border-primary/60 text-primary bg-primary/5"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    Debug
                  </button>
                </div>
            </div>

              {excelError && (
                <p className="text-xs text-destructive mb-2">{excelError}</p>
              )}

              {excelSheets.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  {excelSheets.map((s) => (
                    <button
                      key={s}
                      onClick={() => setExcelSheet(s)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        excelSheet === s
                          ? "border-primary/60 text-primary bg-primary/5"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {excelLoading ? (
                <p className="text-xs text-muted-foreground">Đang tải dữ liệu...</p>
              ) : excelRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Chưa có dữ liệu sheet.</p>
              ) : (
                <div className="overflow-auto border border-border rounded-lg">
                  <table className="min-w-full text-xs">
                    <tbody>
                      {excelRows.slice(0, 200).map((row, idx) => (
                        <tr key={idx} className={idx === 0 ? "bg-muted/50 font-semibold" : ""}>
                          {row.map((cell, cidx) => {
                            const formulaRow = excelFormulas[idx] ?? [];
                            const hasFormula = formulaRow[cidx] === true;
                            const hasValue = cell !== null && cell !== undefined && cell !== "";
                            const errorText = excelErrors[idx]?.[cidx] ?? "";
                            const formulaText = excelFormulaText[idx]?.[cidx] ?? "";
                            const isError = excelDebug && errorText;
                            const displayValue = excelDebug
                              ? isError
                                ? `ERR: ${errorText}`
                                : formulaText
                                  ? formulaText
                                  : cell
                              : cell;
                            const highlight =
                              idx > 0 &&
                              !hasFormula &&
                              hasValue &&
                              typeof displayValue === "number";
                            const isEditing = excelEdit?.row === idx && excelEdit?.col === cidx;
                            const isEditable = idx > 0 && !hasFormula && !excelDebug;
                            const isNumeric =
                              !isEditing &&
                              !excelDebug &&
                              typeof displayValue === "number";
                            return (
                            <td
                              key={cidx}
                              className={`px-2 py-1 border-b border-border whitespace-nowrap ${
                                highlight ? "underline decoration-amber-400 decoration-2 underline-offset-2" : ""
                              } ${isError ? "text-destructive" : ""} ${isEditable ? "cursor-pointer" : ""} ${
                                isNumeric ? "text-right tabular-nums" : ""
                              }`}
                              onClick={() => {
                                if (!isEditable) return;
                                startExcelEdit(idx, cidx, cell === null || cell === undefined ? "" : String(cell));
                              }}
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  className="w-full bg-transparent outline-none text-xs"
                                  value={excelEdit?.value ?? ""}
                                  onChange={(e) => setExcelEdit((prev) => prev ? { ...prev, value: e.target.value } : prev)}
                                  onBlur={commitExcelEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitExcelEdit();
                                    if (e.key === "Escape") setExcelEdit(null);
                                  }}
                                />
                              ) : (
                                displayValue === null || displayValue === undefined || displayValue === ""
                                  ? "—"
                                  : typeof displayValue === "number"
                                    ? formatExcelNumber(displayValue)
                                    : String(displayValue)
                              )}
                            </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
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
