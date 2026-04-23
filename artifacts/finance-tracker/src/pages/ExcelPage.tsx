import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  getGetPortfolioSummaryQueryKey,
  getListHoldingsQueryKey,
  getListSnapshotsQueryKey,
} from "@workspace/api-client-react";

function formatExcelNumber(value: number) {
  return value.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function readJsonSafe(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(text?.slice(0, 120) || "Phản hồi không hợp lệ.");
  }
  return res.json();
}

function isInvestmentSheetName(name: string) {
  return name.trim().toLowerCase().startsWith("investment");
}

type ExcelSourceInfo = {
  mode: "local" | "google_drive";
  readOnly: boolean;
  label: string;
};

export default function ExcelPage() {
  const queryClient = useQueryClient();
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
  const [excelSyncingInvestment, setExcelSyncingInvestment] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [excelNotice, setExcelNotice] = useState<string | null>(null);
  const [excelSource, setExcelSource] = useState<ExcelSourceInfo>({
    mode: "local",
    readOnly: false,
    label: "Local file",
  });
  const excelFileRef = useRef<HTMLInputElement | null>(null);

  const yearHeaderCols = useMemo(() => {
    const header = excelRows[0] ?? [];
    const set = new Set<number>();
    header.forEach((cell, index) => {
      const label = String(cell ?? "").trim().toLowerCase();
      if (label === "year" || label.includes("năm")) set.add(index);
    });
    return set;
  }, [excelRows]);

  const loadExcelSheets = useCallback(async () => {
    setExcelError(null);
    setExcelNotice(null);
    setExcelLoading(true);
    try {
      const res = await fetch("/api/excel/sheets");
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể tải danh sách sheet.");
      const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
      if (data?.source) {
        setExcelSource(data.source as ExcelSourceInfo);
      }
      setExcelSheets(sheets);
      if (sheets.length && !excelSheet) setExcelSheet(sheets[0]);
    } catch (err) {
      setExcelError(err instanceof Error ? err.message : "Không thể tải danh sách sheet.");
    } finally {
      setExcelLoading(false);
    }
  }, [excelSheet]);

  const loadExcelSheet = useCallback(async (name: string) => {
    if (!name) return;
    setExcelError(null);
    setExcelNotice(null);
    setExcelLoading(true);
    try {
      const debugParam = excelDebug ? "&debug=1" : "";
      const res = await fetch(`/api/excel/sheet?name=${encodeURIComponent(name)}${debugParam}`);
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể tải dữ liệu sheet.");
      if (data?.source) {
        setExcelSource(data.source as ExcelSourceInfo);
      }
      if (typeof data?.name === "string" && data.name && data.name !== name) {
        setExcelSheet(data.name);
      }
      setExcelRows(Array.isArray(data?.rows) ? data.rows : []);
      setExcelFormulas(Array.isArray(data?.formulas) ? data.formulas : []);
      if (excelDebug && data?.debug) {
        setExcelFormulaText(Array.isArray(data.debug?.formulaText) ? data.debug.formulaText : []);
        setExcelErrors(Array.isArray(data.debug?.errors) ? data.debug.errors : []);
      } else {
        setExcelFormulaText([]);
        setExcelErrors([]);
      }
    } catch (err) {
      setExcelError(err instanceof Error ? err.message : "Không thể tải dữ liệu sheet.");
    } finally {
      setExcelLoading(false);
    }
  }, [excelDebug]);

  const handleExcelUpload = async (file: File) => {
    setExcelError(null);
    setExcelNotice(null);
    setExcelUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/excel/upload", { method: "POST", body: form });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể upload file Excel.");
      if (data?.source) {
        setExcelSource(data.source as ExcelSourceInfo);
      }
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
    setExcelNotice(null);
    setExcelLoading(true);
    try {
      const res = await fetch("/api/excel/sheet/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, overrides }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Không thể tính lại dữ liệu sheet.");
      if (data?.source) {
        setExcelSource(data.source as ExcelSourceInfo);
      }
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
            const numericValue = Number(trimmed.replace(/,/g, ""));
            return Number.isFinite(numericValue) && trimmed.match(/^[-+]?[\d,.]+$/)
              ? numericValue
              : trimmed;
          })();
    const key = `${row},${col}`;
    const nextOverrides = { ...excelOverrides, [key]: parsed };
    setExcelOverrides(nextOverrides);
    if (excelSheet) recalcExcelSheet(excelSheet, nextOverrides);
    setExcelEdit(null);
  };

  const syncInvestmentToAssets = useCallback(async () => {
    setExcelError(null);
    setExcelNotice(null);
    setExcelSyncingInvestment(true);
    try {
      const res = await fetch("/api/excel/investment/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: excelSheet,
          overrides: excelOverrides,
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Unable to sync Investment to assets.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() }),
      ]);
      const warning = typeof data?.warning === "string" && data.warning ? ` Warning: ${data.warning}` : "";
      setExcelNotice(
        `${data?.message || "Sync completed."} Created: ${data?.created ?? 0}, updated: ${data?.updated ?? 0}, removed: ${data?.removed ?? 0}.${warning}`
      );
    } catch (err) {
      setExcelError(err instanceof Error ? err.message : "Unable to sync Investment to assets.");
    } finally {
      setExcelSyncingInvestment(false);
    }
  }, [excelOverrides, excelSheet, queryClient]);

  useEffect(() => {
    loadExcelSheets();
  }, [loadExcelSheets]);

  useEffect(() => {
    if (!excelSheet) return;
    setExcelOverrides({});
    loadExcelSheet(excelSheet);
  }, [excelSheet, loadExcelSheet]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-3 sm:px-4 md:px-6 py-3 sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight">Excel Sheets</h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
              <Link href="/assets" className="hover:text-foreground transition-colors">
                Investment
              </Link>
              <Link href="/wealth-allocation" className="hover:text-foreground transition-colors">
                Wealth Allocation
              </Link>
              <Link href="/excel" className="hover:text-foreground transition-colors">
                Excel
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full max-w-screen-sm md:max-w-5xl xl:max-w-7xl mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Excel Sheets</p>
              <p className="text-xs text-muted-foreground">Chọn sheet để xem dạng bảng</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Nguồn dữ liệu: {excelSource.label}
                {excelSource.readOnly ? " • chỉnh sửa tại nguồn rồi app tự đọc" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!excelSource.readOnly && (
                <>
                  <input
                    ref={excelFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleExcelUpload(file);
                    }}
                  />
                  <button
                    onClick={() => excelFileRef.current?.click()}
                    className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:border-primary/40"
                    disabled={excelUploading}
                  >
                    {excelUploading ? "Đang import..." : "Import file"}
                  </button>
                </>
              )}
              <button
                onClick={() => setExcelDebug((previous) => !previous)}
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

          {excelError && <p className="text-xs text-destructive mb-2">{excelError}</p>}
          {excelNotice && <p className="text-xs text-emerald-400 mb-2">{excelNotice}</p>}

          {excelSheets.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {excelSheets.map((sheet) => (
                <button
                  key={sheet}
                  onClick={() => setExcelSheet(sheet)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    excelSheet === sheet
                      ? "border-primary/60 text-primary bg-primary/5"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {sheet}
                </button>
              ))}
              {isInvestmentSheetName(excelSheet) && (
                <button
                  onClick={syncInvestmentToAssets}
                  disabled={excelSyncingInvestment}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    excelSyncingInvestment
                      ? "border-primary/40 text-primary/70 bg-primary/5"
                      : "border-primary/60 text-primary bg-primary/5 hover:border-primary"
                  }`}
                >
                  {excelSyncingInvestment ? "Syncing..." : "Sync Investment -> Assets"}
                </button>
              )}
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
                  {excelRows.slice(0, 200).map((row, rowIndex) => (
                    <tr key={rowIndex} className={rowIndex === 0 ? "bg-muted/50 font-semibold" : ""}>
                      {row.map((cell, colIndex) => {
                        const formulaRow = excelFormulas[rowIndex] ?? [];
                        const hasFormula = formulaRow[colIndex] === true;
                        const hasValue = cell !== null && cell !== undefined && cell !== "";
                        const errorText = excelErrors[rowIndex]?.[colIndex] ?? "";
                        const formulaText = excelFormulaText[rowIndex]?.[colIndex] ?? "";
                        const isError = excelDebug && errorText;
                        const displayValue = excelDebug
                          ? isError
                            ? `ERR: ${errorText}`
                            : formulaText || cell
                          : cell;
                        const isYearCol = yearHeaderCols.has(colIndex);
                        const highlight =
                          rowIndex > 0 &&
                          !hasFormula &&
                          hasValue &&
                          typeof displayValue === "number" &&
                          !isYearCol;
                        const isEditing = excelEdit?.row === rowIndex && excelEdit?.col === colIndex;
                        const isEditable = rowIndex > 0 && !hasFormula && !excelDebug && !excelSource.readOnly;
                        const isNumeric =
                          !isEditing &&
                          !excelDebug &&
                          typeof displayValue === "number" &&
                          !isYearCol;

                        return (
                          <td
                            key={colIndex}
                            className={`px-2 py-1 border-b border-border whitespace-nowrap ${
                              highlight ? "underline decoration-amber-400 decoration-2 underline-offset-2" : ""
                            } ${isError ? "text-destructive" : ""} ${
                              isEditable ? "cursor-pointer" : ""
                            } ${isNumeric ? "text-right tabular-nums" : ""}`}
                            onClick={() => {
                              if (!isEditable) return;
                              startExcelEdit(
                                rowIndex,
                                colIndex,
                                cell === null || cell === undefined ? "" : String(cell)
                              );
                            }}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                className="w-full bg-transparent outline-none text-xs"
                                value={excelEdit?.value ?? ""}
                                onChange={(event) =>
                                  setExcelEdit((previous) =>
                                    previous ? { ...previous, value: event.target.value } : previous
                                  )
                                }
                                onBlur={commitExcelEdit}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") commitExcelEdit();
                                  if (event.key === "Escape") setExcelEdit(null);
                                }}
                              />
                            ) : displayValue === null || displayValue === undefined || displayValue === "" ? (
                              "—"
                            ) : typeof displayValue === "number" ? (
                              isYearCol ? String(Math.trunc(displayValue)) : formatExcelNumber(displayValue)
                            ) : (
                              String(displayValue)
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
      </main>
    </div>
  );
}
