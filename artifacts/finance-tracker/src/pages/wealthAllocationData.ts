import type { HoldingItem } from "@/pages/assets/types";

export const CURRENT_ASSET_SHEET = "Current asset";

async function readJsonSafe(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(text?.slice(0, 120) || "Invalid response.");
  }
  return res.json();
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeWealthType(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—" || raw === "-") return "other";
  return raw.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, "_");
}

function parseAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—" || raw === "-") return 0;
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findColumn(headers: unknown[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

export function parseCurrentAssetRows(rows: Array<Array<string | number>>): HoldingItem[] {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return headers.includes("asset") && headers.includes("type");
  });

  if (headerIndex < 0) return [];

  const headers = rows[headerIndex] ?? [];
  const assetCol = findColumn(headers, ["asset", "tai san", "tài sản"]);
  const typeCol = findColumn(headers, ["type", "loai", "loại"]);
  const valueCol = findColumn(headers, ["current price", "current", "value", "usd"]);

  if (assetCol < 0 || typeCol < 0 || valueCol < 0) return [];

  return rows
    .slice(headerIndex + 1)
    .map((row, index): HoldingItem | null => {
      const symbol = String(row[assetCol] ?? "").trim();
      const currentValue = parseAmount(row[valueCol]);
      if (!symbol || symbol === "—" || currentValue <= 0) return null;

      return {
        id: index + 1,
        symbol,
        type: normalizeWealthType(row[typeCol]),
        quantity: 1,
        currentPrice: currentValue,
        currentValue,
        change: null,
        changePercent: null,
        manualPrice: currentValue,
      } satisfies HoldingItem;
    })
    .filter((holding): holding is HoldingItem => holding !== null);
}

export async function fetchWealthAllocationHoldings() {
  const res = await fetch(`/api/excel/sheet?name=${encodeURIComponent(CURRENT_ASSET_SHEET)}`);
  const data = await readJsonSafe(res);
  if (!res.ok) throw new Error(data?.error || "Unable to load wealth allocation sheet.");
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return parseCurrentAssetRows(rows);
}
