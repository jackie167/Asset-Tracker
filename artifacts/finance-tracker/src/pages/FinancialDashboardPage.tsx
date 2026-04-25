import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import AllocationChart from "@/pages/assets/AllocationChart";
import PerformanceChart from "@/pages/assets/PerformanceChart";
import type { ChartPoint, HoldingItem, SnapshotRange } from "@/pages/assets/types";
import { formatVND, formatVNDFull } from "@/pages/assets/utils";
import { fetchWealthAllocationHoldings, normalizeWealthType } from "@/pages/wealthAllocationData";

// ─── helpers ────────────────────────────────────────────────────────────────

function formatPercent(v: number | null | undefined, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

function pctOf(part: number, total: number) {
  return total > 0 ? part / total : null;
}

type Tone = "positive" | "negative" | "neutral" | "warn";
function tone(v: number | null | undefined, positiveThreshold = 0): Tone {
  if (v == null) return "neutral";
  return v >= positiveThreshold ? "positive" : "negative";
}

const TONE_CLASS: Record<Tone, string> = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  warn: "text-amber-400",
  neutral: "text-muted-foreground",
};

// ─── fetchers ────────────────────────────────────────────────────────────────

async function fetchInvestmentSummary() {
  const res = await fetch("/api/portfolio/summary");
  if (!res.ok) throw new Error("Failed to load investment data.");
  return res.json() as Promise<{ holdings: HoldingItem[]; totalValue: number }>;
}

async function fetchXirr() {
  const res = await fetch("/api/portfolio/xirr");
  const data = await res.json().catch(() => null);
  return {
    xirrAnnual: typeof data?.xirrAnnual === "number" ? data.xirrAnnual : null,
    xirrMonthly: typeof data?.xirrMonthly === "number" ? data.xirrMonthly : null,
  };
}

async function fetchSnapshots(range: SnapshotRange) {
  const res = await fetch(`/api/snapshots?range=${encodeURIComponent(range)}`);
  if (!res.ok) throw new Error("Failed to load snapshots.");
  return res.json();
}

async function fetchTransactions() {
  const res = await fetch("/api/transactions");
  if (!res.ok) return [];
  return res.json() as Promise<Array<{ side: string; status: string; fundingSource: string; totalValue: number }>>;
}

type CashflowData = {
  income: number;
  expense: number;
  interest: number;
  savingsRate: number | null;
  interestBurden: number | null;
  year: number;
};

type TotalAssetData = {
  totalAsset: number;
  netAsset: number;
  debt: number;
  debtRatio: number | null;
  year: number;
};

function parseNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.,-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findColIdx(headers: unknown[], names: string[]): number {
  return headers.findIndex((h) =>
    names.includes(String(h ?? "").trim().toLowerCase())
  );
}

async function fetchCashflowData(): Promise<CashflowData | null> {
  const res = await fetch("/api/excel/sheet?name=Cashflow");
  if (!res.ok) return null;
  const data = await res.json();
  const rows: unknown[][] = data?.rows ?? [];
  if (rows.length < 2) return null;

  const headers = rows[0];
  const yearCol = findColIdx(headers, ["year", "năm"]);
  const incomeCol = findColIdx(headers, ["income"]);
  const expenseCol = findColIdx(headers, ["tiêu dùng", "tieu dung", "expense", "tiêu dụng"]);
  const interestCol = findColIdx(headers, ["interest"]);
  if (yearCol < 0 || incomeCol < 0) return null;

  const currentYear = new Date().getFullYear();
  const targetRow =
    rows.slice(1).find((r) => Number(r[yearCol]) === currentYear) ??
    rows.slice(1).findLast((r) => Number(r[yearCol]) <= currentYear) ??
    rows[1];

  if (!targetRow) return null;
  const year = Number(targetRow[yearCol]);
  const income = parseNum(targetRow[incomeCol]);
  const expense = Math.abs(parseNum(expenseCol >= 0 ? targetRow[expenseCol] : 0));
  const interest = Math.abs(parseNum(interestCol >= 0 ? targetRow[interestCol] : 0));
  const savings = income - expense;

  return {
    year,
    income,
    expense,
    interest,
    savingsRate: income > 0 ? savings / income : null,
    interestBurden: income > 0 ? interest / income : null,
  };
}

async function fetchTotalAssetData(): Promise<TotalAssetData | null> {
  const res = await fetch("/api/excel/sheet?name=Total Asset");
  if (!res.ok) return null;
  const data = await res.json();
  const rows: unknown[][] = data?.rows ?? [];
  if (rows.length < 2) return null;

  const headers = rows[0];
  const yearCol = findColIdx(headers, ["year", "năm"]);
  const totalCol = findColIdx(headers, ["tổng tài sản", "tong tai san"]);
  const netCol = findColIdx(headers, ["tài sản ròng", "tai san rong"]);
  const debtCol = findColIdx(headers, ["nợ", "no"]);
  if (yearCol < 0 || totalCol < 0) return null;

  const currentYear = new Date().getFullYear();
  const targetRow =
    rows.slice(1).find((r) => Number(r[yearCol]) === currentYear) ??
    rows.slice(1).findLast((r) => Number(r[yearCol]) <= currentYear) ??
    rows[1];

  if (!targetRow) return null;
  const year = Number(targetRow[yearCol]);
  const totalAsset = parseNum(targetRow[totalCol]);
  const netAsset = netCol >= 0 ? parseNum(targetRow[netCol]) : totalAsset;
  const debt = Math.abs(parseNum(debtCol >= 0 ? targetRow[debtCol] : 0));

  return {
    year,
    totalAsset,
    netAsset,
    debt,
    debtRatio: totalAsset > 0 ? debt / totalAsset : null,
  };
}

// ─── sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  tone: t = "neutral",
  loading = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <Card className="p-4 space-y-1">
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</p>
      {loading ? (
        <div className="h-7 w-28 rounded bg-muted animate-pulse" />
      ) : (
        <p className={`text-2xl font-bold tabular-nums ${TONE_CLASS[t]}`}>{value}</p>
      )}
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

type HealthRowProps = {
  label: string;
  value: string;
  pct: number | null;
  low: number;
  high: number;
  hint: string;
};

function HealthRow({ label, value, pct, low, high, hint }: HealthRowProps) {
  const status: Tone =
    pct == null ? "neutral" : pct < low ? "warn" : pct > high ? "warn" : "positive";
  const barPct = pct != null ? Math.min(Math.round(pct * 100), 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground font-medium">{label}</span>
        <span className={TONE_CLASS[status]}>{value}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            status === "positive" ? "bg-emerald-500" : status === "warn" ? "bg-amber-400" : "bg-red-400"
          }`}
          style={{ width: `${barPct}%` }}
        />
        {/* target band markers */}
        <div
          className="absolute top-0 h-full w-px bg-white/30"
          style={{ left: `${low * 100}%` }}
        />
        <div
          className="absolute top-0 h-full w-px bg-white/30"
          style={{ left: `${high * 100}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function FinancialDashboardPage() {
  const [hideValues, setHideValues] = useState(() => localStorage.getItem("hide_values") === "1");
  const [snapshotRange, setSnapshotRange] = useState<SnapshotRange>("1m");

  // Wealth allocation (all assets from Excel)
  const [wealthHoldings, setWealthHoldings] = useState<HoldingItem[]>([]);
  const [wealthLoading, setWealthLoading] = useState(false);

  const loadWealth = useCallback(async () => {
    setWealthLoading(true);
    try {
      setWealthHoldings(await fetchWealthAllocationHoldings());
    } catch {
      // silently ignore — partial dashboard still useful
    } finally {
      setWealthLoading(false);
    }
  }, []);

  useEffect(() => { loadWealth(); }, [loadWealth]);

  const investmentQuery = useQuery({ queryKey: ["dashboard-investment"], queryFn: fetchInvestmentSummary });
  const xirrQuery = useQuery({ queryKey: ["portfolio-xirr"], queryFn: fetchXirr });
  const snapshotsQuery = useQuery({ queryKey: ["dashboard-snapshots", snapshotRange], queryFn: () => fetchSnapshots(snapshotRange) });
  const transactionsQuery = useQuery({ queryKey: ["transactions"], queryFn: fetchTransactions });
  const cashflowQuery = useQuery({ queryKey: ["excel-cashflow"], queryFn: fetchCashflowData });
  const totalAssetQuery = useQuery({ queryKey: ["excel-total-asset"], queryFn: fetchTotalAssetData });

  // ── derived values ─────────────────────────────────────────────────────────

  const netWorth = useMemo(
    () => wealthHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0),
    [wealthHoldings]
  );

  const investmentHoldings: HoldingItem[] = investmentQuery.data?.holdings ?? [];

  const financialTotal = useMemo(
    () => investmentHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0),
    [investmentHoldings]
  );

  // Cash adjustment: same logic as AssetsPage to avoid double-counting
  const cashAdjustedCost = useMemo(() => {
    const cashHolding = investmentHoldings.find((h) => h.type.trim().toLowerCase() === "cash");
    if (!cashHolding || cashHolding.costOfCapital == null) return null;
    const totalBuyFromCash = (transactionsQuery.data ?? []).reduce((sum, t) => {
      if (t.side !== "buy" || t.status !== "applied") return sum;
      if (t.fundingSource.trim().toUpperCase() !== "CASH") return sum;
      return sum + t.totalValue;
    }, 0);
    return cashHolding.costOfCapital - totalBuyFromCash;
  }, [investmentHoldings, transactionsQuery.data]);

  const costTotal = useMemo(
    () => investmentHoldings.reduce((sum, h) => {
      const effectiveCost =
        h.type.trim().toLowerCase() === "cash" && cashAdjustedCost != null
          ? cashAdjustedCost
          : h.costOfCapital ?? 0;
      return sum + effectiveCost;
    }, 0),
    [investmentHoldings, cashAdjustedCost]
  );

  const pnl = financialTotal - costTotal;
  const pnlPct = pctOf(pnl, costTotal);
  const xirrAnnual = xirrQuery.data?.xirrAnnual ?? null;

  // Group investment by type for health ratios
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of investmentHoldings) {
      const key = h.type.toLowerCase().trim();
      map.set(key, (map.get(key) ?? 0) + (h.currentValue ?? 0));
    }
    return map;
  }, [investmentHoldings]);

  const cashValue = byType.get("cash") ?? 0;
  const stockValue = byType.get("stock") ?? 0;
  const goldValue = byType.get("gold") ?? 0;
  const cryptoValue = byType.get("crypto") ?? 0;
  const fundValue = byType.get("fund") ?? byType.get("bond") ?? 0;

  // Wealth type groups (from Excel)
  const wealthByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of wealthHoldings) {
      const key = normalizeWealthType(h.type);
      map.set(key, (map.get(key) ?? 0) + (h.currentValue ?? 0));
    }
    return map;
  }, [wealthHoldings]);

  // Chart data
  const chartData = useMemo(() =>
    [...(snapshotsQuery.data ?? [])]
      .sort((a: any, b: any) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime())
      .reduce((acc: ChartPoint[], s: any) => {
        const dateKey = format(new Date(s.snapshotAt), "dd/MM");
        const existing = acc.find((i) => i.date === dateKey);
        if (existing) {
          existing.totalValue = s.totalValue;
          existing.stockValue = s.stockValue;
          existing.goldValue = s.goldValue;
        } else {
          acc.push({ date: dateKey, totalValue: s.totalValue, stockValue: s.stockValue, goldValue: s.goldValue });
        }
        return acc;
      }, []),
    [snapshotsQuery.data]
  );

  const fmt = (v: number | null | undefined, full = false) =>
    hideValues ? "****" : full ? formatVNDFull(v) : formatVND(v);

  const investLoading = investmentQuery.isLoading;

  // ── health scores ──────────────────────────────────────────────────────────

  const cashRatio = pctOf(cashValue, financialTotal);       // target 15-30%
  const stockRatio = pctOf(stockValue, financialTotal);     // target 20-50%
  const goldRatio = pctOf(goldValue, financialTotal);       // target 5-20%
  const cryptoRatio = pctOf(cryptoValue, financialTotal);   // target <10%
  const financialRatio = pctOf(financialTotal, netWorth);   // target >20%

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-3 sm:px-4 md:px-6 py-3 sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight uppercase">Financial Dashboard</h1>
            <p className="text-xs text-muted-foreground">Tổng quan sức khoẻ tài chính cá nhân</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/assets" className="hover:text-foreground transition-colors">Investment</Link>
            <Link href="/wealth-allocation" className="hover:text-foreground transition-colors">Wealth</Link>
            <button
              type="button"
              onClick={() => {
                const next = !hideValues;
                setHideValues(next);
                localStorage.setItem("hide_values", next ? "1" : "0");
              }}
              className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
              title={hideValues ? "Show values" : "Hide values"}
            >
              {hideValues ? "👁‍🗨" : "👁"}
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-6 space-y-6">

        {/* ── Tổng quan số liệu ─────────────────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Tổng quan</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Tổng tài sản"
              value={fmt(netWorth, true)}
              sub="Tất cả danh mục"
              loading={wealthLoading}
            />
            <StatCard
              label="Tài sản tài chính"
              value={fmt(financialTotal, true)}
              sub={`${formatPercent(financialRatio)} tổng tài sản`}
              loading={investLoading}
            />
            <StatCard
              label="Lợi nhuận đầu tư"
              value={fmt(pnl, true)}
              sub={formatPercent(pnlPct)}
              tone={tone(pnl)}
              loading={investLoading}
            />
            <StatCard
              label="XIRR / Năm"
              value={formatPercent(xirrAnnual)}
              sub={xirrAnnual != null ? (xirrAnnual >= 0.1 ? "Trên mục tiêu 10%" : "Dưới mục tiêu 10%") : "Chưa có dữ liệu"}
              tone={xirrAnnual == null ? "neutral" : xirrAnnual >= 0.1 ? "positive" : xirrAnnual >= 0 ? "warn" : "negative"}
              loading={xirrQuery.isLoading}
            />
          </div>
        </section>

        {/* ── Phân bổ tài sản ─────────────────────────────────────────────── */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Phân bổ tổng tài sản</p>
            {wealthLoading ? (
              <Card className="p-4 h-40 flex items-center justify-center text-muted-foreground text-xs">Loading…</Card>
            ) : (
              <AllocationChart holdings={wealthHoldings} totalValue={netWorth} />
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Cơ cấu tài sản tài chính</p>
            {investLoading ? (
              <Card className="p-4 h-40 flex items-center justify-center text-muted-foreground text-xs">Loading…</Card>
            ) : (
              <AllocationChart holdings={investmentHoldings} totalValue={financialTotal} />
            )}
          </div>
        </section>

        {/* ── Hiệu suất đầu tư ─────────────────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Hiệu suất đầu tư</p>
          <PerformanceChart
            title=""
            chartData={chartData}
            hideValues={hideValues}
            selectedRange={snapshotRange}
            onRangeChange={setSnapshotRange}
            emptyMessage="Chưa có lịch sử hiệu suất."
          />
        </section>

        {/* ── Chỉ báo sức khoẻ tài chính ──────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Chỉ báo sức khoẻ tài chính</p>
          <Card className="p-4 md:p-6 grid md:grid-cols-2 gap-6">

            {/* Cột trái — tỷ lệ phân bổ */}
            <div className="space-y-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cơ cấu tài chính</p>

              <HealthRow
                label="Tiền mặt"
                value={hideValues ? "****" : `${fmt(cashValue)} · ${formatPercent(cashRatio)}`}
                pct={cashRatio}
                low={0.15} high={0.30}
                hint="Mục tiêu 15–30% — quỹ dự phòng & thanh khoản"
              />
              <HealthRow
                label="Cổ phiếu"
                value={hideValues ? "****" : `${fmt(stockValue)} · ${formatPercent(stockRatio)}`}
                pct={stockRatio}
                low={0.20} high={0.50}
                hint="Mục tiêu 20–50% — tăng trưởng dài hạn"
              />
              <HealthRow
                label="Vàng"
                value={hideValues ? "****" : `${fmt(goldValue)} · ${formatPercent(goldRatio)}`}
                pct={goldRatio}
                low={0.05} high={0.20}
                hint="Mục tiêu 5–20% — phòng hộ lạm phát"
              />
              <HealthRow
                label="Quỹ đầu tư"
                value={hideValues ? "****" : `${fmt(fundValue)} · ${formatPercent(pctOf(fundValue, financialTotal))}`}
                pct={pctOf(fundValue, financialTotal)}
                low={0.05} high={0.30}
                hint="Mục tiêu 5–30% — đa dạng hoá thụ động"
              />
              <HealthRow
                label="Crypto"
                value={hideValues ? "****" : `${fmt(cryptoValue)} · ${formatPercent(cryptoRatio)}`}
                pct={cryptoRatio}
                low={0} high={0.10}
                hint="Nên dưới 10% — rủi ro cao"
              />
            </div>

            {/* Cột phải — chỉ số tổng quan */}
            <div className="space-y-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Chỉ số tổng quan</p>

              <div className="space-y-3">
                {[
                  {
                    label: "Tỷ lệ tài sản tài chính / Tổng",
                    value: formatPercent(financialRatio),
                    tone: financialRatio != null && financialRatio >= 0.15 ? "positive" as Tone : "warn" as Tone,
                    desc: "Nên >15% tổng tài sản để có thanh khoản",
                  },
                  {
                    label: "Đa dạng hoá",
                    value: `${byType.size} loại tài sản`,
                    tone: byType.size >= 4 ? "positive" as Tone : byType.size >= 2 ? "warn" as Tone : "negative" as Tone,
                    desc: "Nên ≥4 loại để phân tán rủi ro",
                  },
                  {
                    label: "XIRR so với lạm phát (4%)",
                    value: formatPercent(xirrAnnual),
                    tone: xirrAnnual == null ? "neutral" as Tone : xirrAnnual >= 0.04 ? "positive" as Tone : "negative" as Tone,
                    desc: "Sinh lời thực dương khi XIRR > lạm phát",
                  },
                  {
                    label: "XIRR so với mục tiêu (10%)",
                    value: xirrAnnual != null ? (xirrAnnual >= 0.1 ? "Đạt" : "Chưa đạt") : "—",
                    tone: xirrAnnual == null ? "neutral" as Tone : xirrAnnual >= 0.1 ? "positive" as Tone : "warn" as Tone,
                    desc: "10%/năm là mức sinh lời dài hạn hợp lý",
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4 border-b border-border/40 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-xs text-foreground">{row.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{row.desc}</p>
                    </div>
                    <p className={`text-sm font-semibold whitespace-nowrap ${TONE_CLASS[row.tone]}`}>
                      {hideValues && row.label !== "Đa dạng hoá" && row.label !== "XIRR so với mục tiêu (10%)" ? "****" : row.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

          </Card>
        </section>

        {/* ── Thu nhập & Dòng tiền ─────────────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Thu nhập & Dòng tiền
            {cashflowQuery.data && (
              <span className="ml-2 normal-case text-muted-foreground/60">năm {cashflowQuery.data.year}</span>
            )}
          </p>
          <Card className="p-4 md:p-6 grid md:grid-cols-2 gap-6">

            {/* Cột trái — tổng quan thu chi */}
            <div className="space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tổng quan năm</p>
              {cashflowQuery.isLoading ? (
                <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-5 rounded bg-muted animate-pulse" />)}</div>
              ) : !cashflowQuery.data ? (
                <p className="text-xs text-muted-foreground">Không thể đọc sheet Cashflow.</p>
              ) : (
                <div className="space-y-3">
                  {[
                    { label: "Thu nhập năm", value: fmt(cashflowQuery.data.income, true), t: "positive" as Tone },
                    { label: "Chi tiêu năm", value: fmt(cashflowQuery.data.expense, true), t: "neutral" as Tone },
                    { label: "Tiết kiệm ròng", value: fmt(cashflowQuery.data.income - cashflowQuery.data.expense, true),
                      t: tone(cashflowQuery.data.income - cashflowQuery.data.expense) },
                    { label: "Thu nhập / tháng (ước)", value: fmt(cashflowQuery.data.income / 12), t: "neutral" as Tone },
                    { label: "Gánh nặng lãi vay", value: formatPercent(cashflowQuery.data.interestBurden),
                      t: (cashflowQuery.data.interestBurden ?? 0) < 0.1 ? "positive" as Tone : "warn" as Tone },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between border-b border-border/30 pb-2 last:border-0 last:pb-0">
                      <p className="text-xs text-muted-foreground">{row.label}</p>
                      <p className={`text-sm font-semibold tabular-nums ${TONE_CLASS[row.t]}`}>
                        {hideValues ? "****" : row.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cột phải — chỉ số tỷ lệ */}
            <div className="space-y-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Chỉ số dòng tiền</p>
              {cashflowQuery.isLoading || totalAssetQuery.isLoading ? (
                <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}</div>
              ) : (
                <div className="space-y-5">
                  <HealthRow
                    label="Tỷ lệ tiết kiệm"
                    value={formatPercent(cashflowQuery.data?.savingsRate)}
                    pct={cashflowQuery.data?.savingsRate ?? null}
                    low={0.20} high={0.50}
                    hint="Mục tiêu 20–50% thu nhập — nền tảng tích lũy"
                  />
                  <HealthRow
                    label="Gánh nặng lãi vay"
                    value={formatPercent(cashflowQuery.data?.interestBurden)}
                    pct={cashflowQuery.data?.interestBurden != null ? 1 - cashflowQuery.data.interestBurden : null}
                    low={0.90} high={1.0}
                    hint="Nên dưới 10% thu nhập — an toàn tài chính"
                  />
                  <HealthRow
                    label="Tỷ lệ nợ / tổng tài sản"
                    value={formatPercent(totalAssetQuery.data?.debtRatio)}
                    pct={totalAssetQuery.data?.debtRatio != null ? 1 - totalAssetQuery.data.debtRatio : null}
                    low={0.70} high={1.0}
                    hint="Nên dưới 30% tổng tài sản"
                  />
                  {totalAssetQuery.data && (
                    <div className="pt-1 border-t border-border/30 space-y-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tài sản & Nợ — {totalAssetQuery.data.year}</p>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Tổng tài sản</span>
                        <span className="font-semibold">{hideValues ? "****" : fmt(totalAssetQuery.data.totalAsset, true)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Tài sản ròng (sau nợ)</span>
                        <span className="font-semibold text-emerald-400">{hideValues ? "****" : fmt(totalAssetQuery.data.netAsset, true)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Nợ</span>
                        <span className="font-semibold text-red-400">{hideValues ? "****" : fmt(totalAssetQuery.data.debt, true)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </Card>
        </section>

      </main>
    </div>
  );
}
