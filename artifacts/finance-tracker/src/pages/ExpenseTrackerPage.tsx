import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatVNDFull } from "@/pages/assets/utils";
import { fetchCashflowData } from "@/lib/excel-sheets";

// ─── constants ───────────────────────────────────────────────────────────────

const BUDGET_RATE = 0.7; // 70% of income

const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: "an_uong",       label: "Ăn uống",           icon: "🍜" },
  { key: "di_chuyen",     label: "Di chuyển",          icon: "🚗" },
  { key: "mua_sam",       label: "Mua sắm",            icon: "🛍️" },
  { key: "giai_tri",      label: "Giải trí",           icon: "🎬" },
  { key: "suc_khoe",      label: "Sức khỏe",           icon: "💊" },
  { key: "giao_duc",      label: "Giáo dục",           icon: "📚" },
  { key: "nha_o_tien_ich",label: "Nhà ở / Tiện ích",   icon: "🏠" },
  { key: "khac",          label: "Khác",               icon: "📦" },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// ─── types ───────────────────────────────────────────────────────────────────

type Expense = {
  id: number;
  amount: number;
  category: string;
  note: string | null;
  occurredAt: string;
  createdAt: string;
};

type Summary = {
  month: string;
  totalSpent: number;
  byCategory: { category: string; label: string; amount: number; count: number }[];
};

// ─── api ────────────────────────────────────────────────────────────────────

async function getExpenses(month: string): Promise<Expense[]> {
  const res = await fetch(`/api/expenses?month=${encodeURIComponent(month)}`);
  if (!res.ok) throw new Error("Failed to load expenses");
  return res.json();
}

async function getSummary(month: string): Promise<Summary> {
  const res = await fetch(`/api/expenses/summary?month=${encodeURIComponent(month)}`);
  if (!res.ok) throw new Error("Failed to load summary");
  return res.json();
}

async function createExpense(body: Omit<Expense, "id" | "createdAt">): Promise<Expense> {
  const res = await fetch("/api/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to create expense");
  return res.json();
}

async function updateExpense(id: number, body: Partial<Omit<Expense, "id" | "createdAt">>): Promise<Expense> {
  const res = await fetch(`/api/expenses/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update expense");
  return res.json();
}

async function deleteExpense(id: number): Promise<void> {
  const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete expense");
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, hide = false) {
  if (hide) return "****";
  return formatVNDFull(v);
}

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// ─── dialog ─────────────────────────────────────────────────────────────────

type DialogState = { open: false } | { open: true; mode: "add" } | { open: true; mode: "edit"; expense: Expense };

function ExpenseDialog({
  state,
  onClose,
  onSave,
}: {
  state: DialogState;
  onClose: () => void;
  onSave: (data: { amount: number; category: string; note: string; occurredAt: string }) => void;
}) {
  const initial = state.open && state.mode === "edit" ? state.expense : null;
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState(initial?.category ?? "an_uong");
  const [note, setNote] = useState(initial?.note ?? "");
  const [date, setDate] = useState(initial ? initial.occurredAt.slice(0, 10) : todayStr());

  if (!state.open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount.replace(/[^0-9.]/g, ""));
    if (!amt || amt <= 0) return;
    onSave({ amount: amt, category, note, occurredAt: new Date(date).toISOString() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{state.mode === "add" ? "Thêm chi tiêu" : "Chỉnh sửa"}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Số tiền (đ)</label>
            <input
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              required
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Danh mục</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Ghi chú</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tùy chọn..."
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Ngày</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onClose}>Huỷ</Button>
            <Button type="submit" size="sm" className="flex-1">Lưu</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ─── main ────────────────────────────────────────────────────────────────────

export default function ExpenseTrackerPage() {
  const [month, setMonth] = useState(currentMonth);
  const [hide, setHide] = useState(() => localStorage.getItem("hide_values") === "1");
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const qc = useQueryClient();

  const expensesQuery = useQuery({ queryKey: ["expenses", month], queryFn: () => getExpenses(month) });
  const summaryQuery = useQuery({ queryKey: ["expenses-summary", month], queryFn: () => getSummary(month) });
  const cashflowQuery = useQuery({ queryKey: ["excel-cashflow"], queryFn: fetchCashflowData });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["expenses", month] });
    qc.invalidateQueries({ queryKey: ["expenses-summary", month] });
  };

  const createMut = useMutation({ mutationFn: createExpense, onSuccess: () => { invalidate(); setDialog({ open: false }); } });
  const updateMut = useMutation({ mutationFn: ({ id, ...body }: { id: number } & Partial<Omit<Expense,"id"|"createdAt">>) => updateExpense(id, body), onSuccess: () => { invalidate(); setDialog({ open: false }); } });
  const deleteMut = useMutation({ mutationFn: deleteExpense, onSuccess: invalidate });

  // Budget = 70% annual income / 12
  const monthlyBudget = useMemo(() => {
    const income = cashflowQuery.data?.income ?? 0;
    return income > 0 ? (income * BUDGET_RATE) / 12 : null;
  }, [cashflowQuery.data]);

  const totalSpent = summaryQuery.data?.totalSpent ?? 0;
  const budgetUsed = monthlyBudget && monthlyBudget > 0 ? totalSpent / monthlyBudget : null;
  const remaining = monthlyBudget != null ? monthlyBudget - totalSpent : null;

  const expenses = expensesQuery.data ?? [];
  const byCategory = summaryQuery.data?.byCategory ?? [];

  const handleSave = (data: { amount: number; category: string; note: string; occurredAt: string }) => {
    if (dialog.open && dialog.mode === "edit") {
      updateMut.mutate({ id: dialog.expense.id, ...data });
    } else {
      createMut.mutate(data as any);
    }
  };

  const barColor = (pct: number | null) => {
    if (!pct) return "bg-primary";
    if (pct >= 1) return "bg-red-500";
    if (pct >= 0.8) return "bg-amber-400";
    return "bg-emerald-500";
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-3 sm:px-4 md:px-6 py-3 sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight uppercase">Chi tiêu</h1>
            <p className="text-xs text-muted-foreground">Theo dõi hóa đơn · Budget {(BUDGET_RATE * 100).toFixed(0)}% thu nhập</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
              <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
              <Link href="/fire" className="hover:text-foreground transition-colors">FIRE</Link>
            </div>
            <button type="button" onClick={() => { const n=!hide; setHide(n); localStorage.setItem("hide_values",n?"1":"0"); }} className="text-muted-foreground hover:text-foreground">{hide ? "👁‍🗨" : "👁"}</button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-6 space-y-6">

        {/* ── Budget Overview ──────────────────────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Tổng quan tháng {month}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Budget tháng", value: fmt(monthlyBudget, hide), sub: monthlyBudget ? `70% × ${fmt(cashflowQuery.data?.income, hide)}/năm ÷ 12` : "Chưa có dữ liệu" },
              { label: "Đã chi", value: fmt(totalSpent, hide), sub: budgetUsed != null ? `${fmtPct(budgetUsed)} ngân sách` : undefined },
              { label: "Còn lại", value: remaining != null ? fmt(remaining, hide) : "—", sub: remaining != null && remaining < 0 ? "Vượt budget!" : undefined },
              { label: "Số giao dịch", value: String(expenses.length), sub: `tháng ${month}` },
            ].map((c) => (
              <Card key={c.label} className="p-4 space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{c.label}</p>
                <p className="text-xl font-bold tabular-nums">{c.value}</p>
                {c.sub && <p className="text-[10px] text-muted-foreground">{c.sub}</p>}
              </Card>
            ))}
          </div>

          {monthlyBudget != null && (
            <Card className="p-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Tổng chi tiêu</span>
                <span className={`font-semibold ${(budgetUsed ?? 0) >= 1 ? "text-red-400" : (budgetUsed ?? 0) >= 0.8 ? "text-amber-400" : "text-emerald-400"}`}>
                  {budgetUsed != null ? fmtPct(budgetUsed) : "—"} ngân sách
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor(budgetUsed)}`}
                  style={{ width: `${Math.min((budgetUsed ?? 0) * 100, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0</span>
                <span className="text-amber-400">80%</span>
                <span className="text-red-400">100% = {fmt(monthlyBudget, hide)}</span>
              </div>
            </Card>
          )}
        </section>

        {/* ── Category Breakdown ───────────────────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Phân loại chi tiêu</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CATEGORIES.map((cat) => {
              const data = byCategory.find((b) => b.category === cat.key);
              const amount = data?.amount ?? 0;
              const catBudget = monthlyBudget != null ? monthlyBudget / CATEGORIES.length : null;
              const pct = catBudget && catBudget > 0 ? amount / catBudget : null;
              return (
                <Card key={cat.key} className="p-3 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{cat.icon}</span>
                    <p className="text-xs font-medium truncate">{cat.label}</p>
                  </div>
                  <p className="text-lg font-bold tabular-nums">{fmt(amount, hide)}</p>
                  {data?.count ? <p className="text-[10px] text-muted-foreground">{data.count} lần</p> : null}
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${barColor(pct)}`} style={{ width: `${Math.min((pct ?? 0) * 100, 100)}%` }} />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* ── Transaction List ─────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Giao dịch ({expenses.length})
            </p>
            <Button size="sm" className="h-8 text-xs" onClick={() => setDialog({ open: true, mode: "add" })}>
              + Thêm chi tiêu
            </Button>
          </div>

          <Card className="overflow-hidden">
            {expensesQuery.isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
            ) : expenses.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-3xl">💸</p>
                <p className="text-sm text-muted-foreground">Chưa có chi tiêu nào tháng này</p>
                <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, mode: "add" })}>
                  Thêm chi tiêu đầu tiên
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {expenses.map((exp) => {
                  const cat = CAT_MAP[exp.category];
                  return (
                    <div key={exp.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <span className="text-xl shrink-0">{cat?.icon ?? "📦"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{cat?.label ?? exp.category}</p>
                        {exp.note && <p className="text-[10px] text-muted-foreground truncate">{exp.note}</p>}
                        <p className="text-[10px] text-muted-foreground">
                          {format(new Date(exp.occurredAt), "dd/MM/yyyy")}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums shrink-0">{fmt(exp.amount, hide)}</p>
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDialog({ open: true, mode: "edit", expense: exp })}
                          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/50 hover:border-border transition"
                        >Edit</button>
                        <button
                          type="button"
                          onClick={() => { if (confirm("Xóa giao dịch này?")) deleteMut.mutate(exp.id); }}
                          className="text-[10px] text-muted-foreground hover:text-red-400 px-1.5 py-0.5 rounded border border-border/50 hover:border-red-400/50 transition"
                        >Del</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>

      </main>

      <ExpenseDialog
        state={dialog}
        onClose={() => setDialog({ open: false })}
        onSave={handleSave}
      />
    </div>
  );
}
