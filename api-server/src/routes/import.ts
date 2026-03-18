import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, holdingsTable } from "../../../lib/db/src/index.ts";
import { eq } from "drizzle-orm";
import { ImportHoldingsResponse } from "../../../lib/api-zod/src/index.ts";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ];
    const extOk = /\.(csv|xls|xlsx)$/i.test(file.originalname);
    if (allowed.includes(file.mimetype) || extOk) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

interface RawRow {
  symbol?: string;
  type?: string;
  quantity?: string | number;
  total_value?: string | number;
  current_price?: string | number;
  [key: string]: unknown;
}

function inferType(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.startsWith("SJC")) return "gold";
  const CRYPTO = ["BTC","ETH","XRP","BNB","SOL","ADA","DOT","AVAX","LINK","MATIC","DOGE","USDT","USDC","PAXG","DAI","LTC","BCH","ATOM","UNI","AAVE"];
  if (CRYPTO.includes(s)) return "crypto";
  return "stock";
}

function parseVNNumber(v: string | number | undefined | null): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return isNaN(v) ? undefined : v;
  const s = String(v).trim().replace(/\s/g, "");
  if (!s) return undefined;

  // Both dot and comma present → dot=thousand sep, comma=decimal (e.g. "1.000,50")
  if (s.includes(",") && s.includes(".")) {
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? undefined : n;
  }

  // Only comma (no dot) → comma is decimal separator (e.g. "0,091" VN style)
  if (s.includes(",")) {
    const n = parseFloat(s.replace(",", "."));
    return isNaN(n) ? undefined : n;
  }

  // Only dot(s):
  if (s.includes(".")) {
    const parts = s.split(".");
    const dotCount = parts.length - 1;

    // Multiple dots → all are thousand separators (e.g. "1.000.000")
    if (dotCount > 1) {
      const n = parseFloat(parts.join(""));
      return isNaN(n) ? undefined : n;
    }

    // Single dot: check if it's a thousand separator or decimal point
    const afterDot = parts[1];
    const beforeDot = parts[0];
    // Thousand separator: non-zero integer part + exactly 3 digits after dot (e.g. "1.000", "83.700")
    // Decimal: starts with "0" (e.g. "0.091"), or afterDot ≠ 3 digits
    if (beforeDot !== "0" && afterDot.length === 3) {
      // Likely VN thousand separator (e.g. "83.700" = 83700)
      const n = parseFloat(beforeDot + afterDot);
      return isNaN(n) ? undefined : n;
    }

    // Otherwise treat as decimal (e.g. "0.0913", "3.9", "1.5")
    return parseFloat(s);
  }

  // No dot, no comma → plain integer
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

function parseCsvLine(line: string, separator: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        cur += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === separator && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsvRows(text: string, separator: string): RawRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0], separator).map((h) => h.trim().toLowerCase());
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], separator);
    const row: RawRow = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;
      row[key] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

interface NormalizedRow {
  symbol: string;
  type?: string;
  quantity: number;
}

function normalizeRow(raw: RawRow): NormalizedRow | null {
  const symbol = String(raw.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;

  const quantity = parseVNNumber(raw.quantity);
  if (quantity == null || quantity <= 0) return null;

  const typeRaw = String(raw.type ?? "").trim().toLowerCase();
  const type = typeRaw || undefined;
  return { symbol, type, quantity };
}

router.post("/holdings/import", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  console.log(`[Import] Processing file: ${req.file.originalname} (${req.file.size} bytes, ${req.file.mimetype})`);

  let rows: RawRow[] = [];

  try {
    const isCsv = req.file.originalname.toLowerCase().endsWith(".csv")
      || req.file.mimetype.includes("csv")
      || req.file.mimetype === "text/plain";

    if (isCsv) {
      const text = req.file.buffer.toString("utf8");
      const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
      const commaCount = (firstLine.match(/,/g) || []).length;
      const semicolonCount = (firstLine.match(/;/g) || []).length;
      const separator = semicolonCount >= commaCount ? ";" : ",";
      rows = parseCsvRows(text, separator);
    } else {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
    }
    const sheetName = isCsv ? "CSV" : "Sheet1";
    console.log(`[Import] Parsed ${rows.length} row(s) from sheet "${sheetName}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Import] Failed to parse file: ${msg}`);
    res.status(400).json({ error: `Could not parse file: ${msg}` });
    return;
  }

  if (rows.length === 0) {
    res.status(400).json({ error: "File is empty or has no data rows" });
    return;
  }

  // Load all existing holdings once
  const existingHoldings = await db.select().from(holdingsTable);
  const bySymbol = new Map(existingHoldings.map((h) => [h.symbol.toUpperCase(), h]));

  const errors: string[] = [];
  const imported: typeof holdingsTable.$inferSelect[] = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const normalized = normalizeRow(rows[i]);
    if (!normalized) {
      errors.push(`Dòng ${i + 2}: thiếu hoặc sai dữ liệu — ${JSON.stringify(rows[i])}`);
      skipped++;
      continue;
    }

    const { symbol, type, quantity } = normalized;

    try {
      const existing = bySymbol.get(symbol);

      if (existing) {
        const updateData: Partial<typeof holdingsTable.$inferInsert> & { updatedAt: Date } = {
          quantity: String(quantity),
          updatedAt: new Date(),
        };

        const [updated] = await db
          .update(holdingsTable)
          .set(updateData)
          .where(eq(holdingsTable.id, existing.id))
          .returning();
        imported.push(updated);
        console.log(`[Import] Updated ${existing.type} ${symbol}: qty=${quantity}`);
      } else {
        // New holding — use provided type or infer; do NOT import total/manual price
        const resolvedType = type || inferType(symbol);

        const [created] = await db
          .insert(holdingsTable)
          .values({
            type: resolvedType,
            symbol,
            quantity: String(quantity),
            manualPrice: null,
          })
          .returning();
        imported.push(created);
        console.log(`[Import] Created ${resolvedType} ${symbol}: qty=${quantity}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${symbol}: lỗi DB — ${msg}`);
      skipped++;
    }
  }

  console.log(`[Import] Done: ${imported.length} imported, ${skipped} skipped, ${errors.length} errors`);

  res.json(
    ImportHoldingsResponse.parse({
      imported: imported.length,
      skipped,
      errors,
      holdings: imported.map((h) => ({
        ...h,
        quantity: parseFloat(String(h.quantity)),
        manualPrice: h.manualPrice != null ? parseFloat(String(h.manualPrice)) : null,
      })),
    })
  );
});

export default router;
