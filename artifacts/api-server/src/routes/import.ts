import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, holdingsTable } from "@workspace/db";
import { ImportHoldingsResponse } from "@workspace/api-zod";

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
  type?: string;
  loai?: string;
  symbol?: string;
  "ma co phieu"?: string;
  "ma vang"?: string;
  quantity?: string | number;
  "so luong"?: string | number;
  [key: string]: unknown;
}

function normalizeRow(raw: RawRow): { type: string; symbol: string; quantity: number } | null {
  const normalize = (v: unknown) => String(v ?? "").trim().toLowerCase();

  const typeRaw = normalize(raw.type ?? raw.loai ?? "");
  const symbolRaw = String(
    raw.symbol ?? raw["ma co phieu"] ?? raw["ma vang"] ?? ""
  ).trim().toUpperCase();
  const quantityRaw = raw.quantity ?? raw["so luong"];
  const quantity = typeof quantityRaw === "number"
    ? quantityRaw
    : parseFloat(String(quantityRaw ?? "").replace(/,/g, "."));

  if (!symbolRaw) return null;
  if (isNaN(quantity) || quantity <= 0) return null;

  let type = "stock";
  if (typeRaw.includes("gold") || typeRaw.includes("vàng") || typeRaw.includes("vang") || symbolRaw.startsWith("SJC")) {
    type = "gold";
  } else if (typeRaw.includes("stock") || typeRaw.includes("co phieu") || typeRaw.includes("cổ phiếu") || typeRaw === "cp") {
    type = "stock";
  } else if (!typeRaw && (symbolRaw.startsWith("SJC"))) {
    type = "gold";
  }

  return { type, symbol: symbolRaw, quantity };
}

router.post("/holdings/import", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  console.log(`[Import] Processing file: ${req.file.originalname} (${req.file.size} bytes, ${req.file.mimetype})`);

  let rows: RawRow[] = [];

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
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

  const errors: string[] = [];
  const toInsert: { type: string; symbol: string; quantity: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const normalized = normalizeRow(rows[i]);
    if (!normalized) {
      errors.push(`Row ${i + 2}: missing or invalid data — ${JSON.stringify(rows[i])}`);
      continue;
    }

    const { type, symbol, quantity } = normalized;

    if (!["stock", "gold"].includes(type)) {
      errors.push(`Row ${i + 2}: unknown type "${type}" for symbol ${symbol}`);
      continue;
    }

    toInsert.push({ type, symbol, quantity: String(quantity) });
  }

  const imported: typeof holdingsTable.$inferSelect[] = [];
  let skipped = rows.length - toInsert.length;

  for (const item of toInsert) {
    try {
      const existing = await db
        .select()
        .from(holdingsTable)
        .then((all) => all.find((h) => h.symbol === item.symbol && h.type === item.type));

      if (existing) {
        const [updated] = await db
          .update(holdingsTable)
          .set({ quantity: item.quantity, updatedAt: new Date() })
          .returning();
        imported.push(updated);
        console.log(`[Import] Updated existing holding: ${item.type} ${item.symbol} qty=${item.quantity}`);
      } else {
        const [created] = await db
          .insert(holdingsTable)
          .values({ type: item.type, symbol: item.symbol, quantity: item.quantity })
          .returning();
        imported.push(created);
        console.log(`[Import] Created new holding: ${item.type} ${item.symbol} qty=${item.quantity}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${item.symbol}: DB error — ${msg}`);
      skipped++;
    }
  }

  console.log(`[Import] Done: ${imported.length} imported, ${skipped} skipped, ${errors.length} errors`);

  res.json(
    ImportHoldingsResponse.parse({
      imported: imported.length,
      skipped,
      errors,
      holdings: imported.map((h) => ({ ...h, quantity: parseFloat(String(h.quantity)) })),
    })
  );
});

export default router;
