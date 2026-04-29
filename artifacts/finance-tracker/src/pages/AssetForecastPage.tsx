import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/pages/PageHeader";
import { Card } from "@/components/ui/card";
import { formatTypeLabel, formatVNDFull } from "@/pages/assets/utils";
import { CASHFLOW_SOURCE_SHEET, findColIdx, parseNum } from "@/lib/excel-sheets";
import { CURRENT_ASSET_SHEET, parseCurrentAssetRows } from "@/pages/wealthAllocationData";
import type { HoldingItem } from "@/pages/assets/types";

const FORECAST_YEARS = [2026, 2027, 2028, 2029, 2030];
const FREE_CASH_ALLOCATION = {
  cash: 0.1,
  gold: 0.3,
  fund: 0.1,
  crypto: 0.1,
};
const STOCK_FREE_CASH_RATIO =
  1 -
  FREE_CASH_ALLOCATION.cash -
  FREE_CASH_ALLOCATION.gold -
  FREE_CASH_ALLOCATION.fund -
  FREE_CASH_ALLOCATION.crypto;

type FreeCashRow = {
  year: number;
  income: number;
  otherIncome: number;
  expense: number;
  otherExpense: number;
  totalInterest: number;
  totalIncome: number;
  totalExpense: number;
  freeCash: number;
};

const LS = {
  get: (key: string, fallback: string) => localStorage.getItem(key) ?? fallback,
  set: (key: string, value: string) => localStorage.setItem(key, value),
};

async function fetchCurrentAssetData(): Promise<HoldingItem[]> {
  try {
    const res = await fetch(`/api/excel/sheet?name=${encodeURIComponent(CURRENT_ASSET_SHEET)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    return parseCurrentAssetRows(rows);
  } catch {
    return [];
  }
}

async function fetchFreeCashRows(): Promise<FreeCashRow[]> {
  try {
    const res = await fetch(`/api/excel/sheet?name=${encodeURIComponent(CASHFLOW_SOURCE_SHEET)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[][] = data?.rows ?? [];
    if (rows.length < 2) return [];

    const headers = rows[0];
    const yearCol = findColIdx(headers, ["year", "năm"]);
    const incomeCol = findColIdx(headers, ["income", "thu nhập", "thu nhap"]);
    const otherIncomeCol = findColIdx(headers, ["other income", "thu nhập khác", "thu nhap khac"]);
    const expenseCol = findColIdx(headers, ["expense", "tiêu dùng", "tieu dung", "tiêu dụng"]);
    const otherExpenseCol = findColIdx(headers, ["other expense", "chi phí khác", "chi phi khac"]);
    const interestCol = findColIdx(headers, ["total interest", "interest", "lãi vay", "lai vay"]);
    if (yearCol < 0 || incomeCol < 0) return [];

    return rows.slice(1).flatMap((row) => {
      const year = Number(row[yearCol]);
      if (!FORECAST_YEARS.includes(year)) return [];

      const income = parseNum(row[incomeCol]);
      const otherIncome = otherIncomeCol >= 0 ? parseNum(row[otherIncomeCol]) : 0;
      const expense = Math.abs(expenseCol >= 0 ? parseNum(row[expenseCol]) : 0);
      const otherExpense = Math.abs(otherExpenseCol >= 0 ? parseNum(row[otherExpenseCol]) : 0);
      const totalInterest = Math.abs(interestCol >= 0 ? parseNum(row[interestCol]) : 0);
      const totalIncome = income + otherIncome;
      const totalExpense = expense + otherExpense + totalInterest;

      return [{
        year,
        income,
        otherIncome,
        expense,
        otherExpense,
        totalInterest,
        totalIncome,
        totalExpense,
        freeCash: totalIncome - totalExpense,
      }];
    });
  } catch {
    return [];
  }
}

function parseInputNumber(value: string): number {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPercentValue(value: number) {
  return `${value.toFixed(2)}%`;
}

function Field({
  label,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-primary">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none"
        />
        {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "muted";
}) {
  const color = tone === "positive" ? "text-emerald-400" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="border-b border-border/30 pb-3 last:border-0 last:pb-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export default function AssetForecastPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(() => LS.get("asset_forecast_year", String(Math.max(2026, currentYear))));
  const [beginningAssetInput, setBeginningAssetInput] = useState(() => LS.get("asset_forecast_beginning_asset", ""));
  const [returnRateInput, setReturnRateInput] = useState(() => LS.get("asset_forecast_return_rate", "8"));
  const [freeCashRatioInput, setFreeCashRatioInput] = useState(() => LS.get("asset_forecast_free_cash_ratio", "100"));
  const [extraCashInput, setExtraCashInput] = useState(() => LS.get("asset_forecast_extra_cash", "0"));

  const currentAssetQuery = useQuery({ queryKey: ["asset-forecast-current-asset"], queryFn: fetchCurrentAssetData });
  const freeCashQuery = useQuery({ queryKey: ["asset-forecast-free-cash-rows"], queryFn: fetchFreeCashRows });

  const currentAssetRows = currentAssetQuery.data ?? [];
  const freeCashRows = freeCashQuery.data ?? [];
  const selectedYear = Number(year);
  const selectedFreeCashRow =
    freeCashRows.find((row) => row.year === selectedYear) ??
    freeCashRows.find((row) => row.year === 2026) ??
    null;
  const currentAssetTotal = currentAssetRows.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0);
  const autoBeginningAsset = currentAssetTotal;
  const beginningAsset = beginningAssetInput.trim() ? parseInputNumber(beginningAssetInput) : autoBeginningAsset;
  const returnRate = parseInputNumber(returnRateInput) / 100;
  const freeCashRatio = parseInputNumber(freeCashRatioInput) / 100;
  const extraCash = parseInputNumber(extraCashInput);
  const annualIncome = selectedFreeCashRow?.totalIncome ?? 0;
  const annualExpense = selectedFreeCashRow?.totalExpense ?? 0;
  const freeCash = selectedFreeCashRow?.freeCash ?? 0;
  const investableFreeCash = freeCash * Math.max(freeCashRatio, 0) + extraCash;

  const forecast = useMemo(() => {
    const investmentGain = beginningAsset * returnRate;
    const endingAsset = beginningAsset + investmentGain + investableFreeCash;
    const totalIncrease = endingAsset - beginningAsset;
    const totalIncreaseRate = beginningAsset > 0 ? totalIncrease / beginningAsset : null;

    return {
      investmentGain,
      endingAsset,
      totalIncrease,
      totalIncreaseRate,
    };
  }, [beginningAsset, investableFreeCash, returnRate]);

  const saveField = (key: string, setter: (value: string) => void) => (value: string) => {
    setter(value);
    LS.set(key, value);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader
        title="Dự báo tài sản"
        subtitle="Ước tính tài sản cuối năm từ tài sản đầu năm, tăng trưởng giả định và free cash"
      />

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-6 space-y-6">
        <section className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-6 items-start">
          <Card className="p-4 md:p-5 space-y-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Giả định</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <Field
                label="Năm dự báo"
                value={year}
                onChange={saveField("asset_forecast_year", setYear)}
              />
              <Field
                label="Tài sản đầu năm"
                value={beginningAssetInput}
                onChange={saveField("asset_forecast_beginning_asset", setBeginningAssetInput)}
                suffix="đ"
                placeholder={currentAssetQuery.isLoading ? "Đang tải..." : formatVNDFull(autoBeginningAsset)}
              />
              <Field
                label="Tỷ suất tăng trưởng giả định"
                value={returnRateInput}
                onChange={saveField("asset_forecast_return_rate", setReturnRateInput)}
                suffix="%/năm"
              />
              <Field
                label="Tỷ lệ free cash đưa vào đầu tư"
                value={freeCashRatioInput}
                onChange={saveField("asset_forecast_free_cash_ratio", setFreeCashRatioInput)}
                suffix="%"
              />
              <Field
                label="Bổ sung thủ công"
                value={extraCashInput}
                onChange={saveField("asset_forecast_extra_cash", setExtraCashInput)}
                suffix="đ"
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Nếu để trống tài sản đầu năm, hệ thống dùng tổng từ sheet {CURRENT_ASSET_SHEET}. Free cash lấy từ sheet {CASHFLOW_SOURCE_SHEET}.
            </p>
          </Card>

          <div className="space-y-6">
            <Card className="p-4 md:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Kết quả năm {year || currentYear}</p>
                {selectedFreeCashRow && (
                  <span className="text-[10px] text-muted-foreground">Free cash {selectedFreeCashRow.year}</span>
                )}
              </div>

              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <Metric label="Tài sản đầu năm" value={formatVNDFull(beginningAsset)} />
                <Metric label="Lãi tăng trưởng" value={formatVNDFull(forecast.investmentGain)} tone={forecast.investmentGain >= 0 ? "positive" : "neutral"} />
                <Metric label="Free cash bổ sung" value={formatVNDFull(investableFreeCash)} tone="positive" />
                <Metric label="Tài sản cuối năm" value={formatVNDFull(forecast.endingAsset)} tone="positive" />
              </div>
            </Card>

            <Card className="p-4 md:p-5">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Chi tiết dòng tính</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs">
                  <tbody className="divide-y divide-border/40">
                    {[
                      ["Tổng income", formatVNDFull(annualIncome)],
                      ["Tổng chi", formatVNDFull(annualExpense)],
                      ["Free cash trước phân bổ", formatVNDFull(freeCash)],
                      ["Free cash đưa vào tài sản", formatVNDFull(investableFreeCash)],
                      ["Tỷ suất tăng trưởng giả định", formatPercentValue(returnRate * 100)],
                      ["Tổng tăng tài sản", formatVNDFull(forecast.totalIncrease)],
                      ["Tỷ lệ tăng tổng", forecast.totalIncreaseRate == null ? "—" : formatPercentValue(forecast.totalIncreaseRate * 100)],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td className="py-2 pr-4 text-muted-foreground">{label}</td>
                        <td className="py-2 text-right font-medium tabular-nums whitespace-nowrap">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Free cash từ sheet {CASHFLOW_SOURCE_SHEET}
            </p>
            <p className="text-[10px] text-muted-foreground">2026-2030</p>
          </div>
          <Card className="p-4 md:p-5">
            {freeCashQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="h-8 rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : freeCashRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa đọc được dữ liệu free cash từ sheet {CASHFLOW_SOURCE_SHEET}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 text-left font-medium">Year</th>
                      <th className="py-2 px-4 text-right font-medium">Income</th>
                      <th className="py-2 px-4 text-right font-medium">Other income</th>
                      <th className="py-2 px-4 text-right font-medium">Expense</th>
                      <th className="py-2 px-4 text-right font-medium">Other expense</th>
                      <th className="py-2 px-4 text-right font-medium">Total interest</th>
                      <th className="py-2 px-4 text-right font-medium">Tổng income</th>
                      <th className="py-2 px-4 text-right font-medium">Tổng chi</th>
                      <th className="py-2 pl-4 text-right font-medium">Free cash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {freeCashRows.map((row) => {
                      const isSelected = row.year === selectedYear;
                      return (
                        <tr key={row.year} className={isSelected ? "bg-primary/5" : undefined}>
                          <td className="py-2 pr-4 font-medium whitespace-nowrap">{row.year}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(row.income)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(row.otherIncome)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(row.expense)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(row.otherExpense)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(row.totalInterest)}</td>
                          <td className="py-2 px-4 text-right tabular-nums font-medium whitespace-nowrap">{formatVNDFull(row.totalIncome)}</td>
                          <td className="py-2 px-4 text-right tabular-nums font-medium whitespace-nowrap">{formatVNDFull(row.totalExpense)}</td>
                          <td className={`py-2 pl-4 text-right tabular-nums font-semibold whitespace-nowrap ${row.freeCash >= 0 ? "text-emerald-400" : "text-red-300"}`}>
                            {formatVNDFull(row.freeCash)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Phân bổ free cash cho investment
            </p>
            <p className="text-[10px] text-muted-foreground">Stock là phần còn lại</p>
          </div>
          <Card className="p-4 md:p-5">
            {freeCashQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="h-8 rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : freeCashRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa có dữ liệu free cash để phân bổ.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 text-left font-medium">Free cash</th>
                      <th className="py-2 px-4 text-right font-medium">Cash</th>
                      <th className="py-2 px-4 text-right font-medium">Gold</th>
                      <th className="py-2 px-4 text-right font-medium">Fund</th>
                      <th className="py-2 px-4 text-right font-medium">Crypto</th>
                      <th className="py-2 pl-4 text-right font-medium">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    <tr className="bg-muted/20">
                      <td className="py-2 pr-4 font-medium whitespace-nowrap">Ratio</td>
                      <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatPercentValue(FREE_CASH_ALLOCATION.cash * 100)}</td>
                      <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatPercentValue(FREE_CASH_ALLOCATION.gold * 100)}</td>
                      <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatPercentValue(FREE_CASH_ALLOCATION.fund * 100)}</td>
                      <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatPercentValue(FREE_CASH_ALLOCATION.crypto * 100)}</td>
                      <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{formatPercentValue(STOCK_FREE_CASH_RATIO * 100)}</td>
                    </tr>
                    {freeCashRows.map((row) => {
                      const allocatableFreeCash = Math.max(row.freeCash, 0);
                      const isSelected = row.year === selectedYear;
                      return (
                        <tr key={`allocation-${row.year}`} className={isSelected ? "bg-primary/5" : undefined}>
                          <td className="py-2 pr-4 whitespace-nowrap">
                            <span className="font-medium">{row.year}</span>
                            <span className={`ml-3 tabular-nums ${row.freeCash >= 0 ? "text-emerald-400" : "text-red-300"}`}>
                              {formatVNDFull(row.freeCash)}
                            </span>
                          </td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(allocatableFreeCash * FREE_CASH_ALLOCATION.cash)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(allocatableFreeCash * FREE_CASH_ALLOCATION.gold)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(allocatableFreeCash * FREE_CASH_ALLOCATION.fund)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(allocatableFreeCash * FREE_CASH_ALLOCATION.crypto)}</td>
                          <td className="py-2 pl-4 text-right tabular-nums font-semibold whitespace-nowrap">{formatVNDFull(allocatableFreeCash * STOCK_FREE_CASH_RATIO)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Data chuẩn bị từ sheet {CURRENT_ASSET_SHEET}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {currentAssetRows.length} dòng · tổng {formatVNDFull(currentAssetTotal)}
            </p>
          </div>
          <Card className="p-4 md:p-5">
            {currentAssetQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((row) => (
                  <div key={row} className="h-8 rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : currentAssetRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa đọc được dữ liệu từ sheet {CURRENT_ASSET_SHEET}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 text-left font-medium">Asset</th>
                      <th className="py-2 px-4 text-left font-medium">Type</th>
                      <th className="py-2 px-4 text-right font-medium">Current asset</th>
                      <th className="py-2 px-4 text-right font-medium">Weight</th>
                      <th className="py-2 px-4 text-right font-medium">Assumed return</th>
                      <th className="py-2 px-4 text-right font-medium">Growth</th>
                      <th className="py-2 pl-4 text-right font-medium">End value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {currentAssetRows.map((holding) => {
                      const currentValue = holding.currentValue ?? 0;
                      const weight = currentAssetTotal > 0 ? currentValue / currentAssetTotal : null;
                      const growth = currentValue * returnRate;
                      const endingValue = currentValue + growth;

                      return (
                        <tr key={`${holding.type}-${holding.symbol}`}>
                          <td className="py-2 pr-4 font-medium whitespace-nowrap">{holding.symbol}</td>
                          <td className="py-2 px-4 text-muted-foreground whitespace-nowrap">{formatTypeLabel(holding.type)}</td>
                          <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">{formatVNDFull(currentValue)}</td>
                          <td className="py-2 px-4 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                            {weight == null ? "—" : formatPercentValue(weight * 100)}
                          </td>
                          <td className="py-2 px-4 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                            {formatPercentValue(returnRate * 100)}
                          </td>
                          <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap ${growth >= 0 ? "text-emerald-400" : "text-red-300"}`}>
                            {formatVNDFull(growth)}
                          </td>
                          <td className="py-2 pl-4 text-right tabular-nums font-semibold whitespace-nowrap">{formatVNDFull(endingValue)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td className="pt-3 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground">Total</td>
                      <td />
                      <td className="pt-3 px-4 text-right tabular-nums font-semibold whitespace-nowrap">{formatVNDFull(currentAssetTotal)}</td>
                      <td className="pt-3 px-4 text-right tabular-nums text-muted-foreground">100.00%</td>
                      <td />
                      <td className={`pt-3 px-4 text-right tabular-nums font-semibold whitespace-nowrap ${forecast.investmentGain >= 0 ? "text-emerald-400" : "text-red-300"}`}>
                        {formatVNDFull(currentAssetTotal * returnRate)}
                      </td>
                      <td className="pt-3 pl-4 text-right tabular-nums font-semibold whitespace-nowrap">{formatVNDFull(currentAssetTotal * (1 + returnRate))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}
