import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { HyperFormula } from "hyperformula";
import fs from "node:fs";
import path from "node:path";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const STORAGE_DIR = path.resolve(process.cwd(), "data");
const STORAGE_FILE = path.join(STORAGE_DIR, "excel-source.xlsx");
const DEFAULT_SOURCE = path.join(STORAGE_DIR, "excel-source.xlsx");

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function loadWorkbook(): XLSX.WorkBook {
  const candidate = fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : DEFAULT_SOURCE;
  if (!fs.existsSync(candidate)) {
    throw new Error("No Excel file available");
  }
  const buffer = fs.readFileSync(candidate);
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

function sheetToGrid(sheet: XLSX.WorkSheet): (string | number | boolean | null)[][] {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return [];

  const rows: (string | number | boolean | null)[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: (string | number | boolean | null)[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellRef] as XLSX.CellObject | undefined;
      if (!cell) {
        row.push(null);
        continue;
      }
      if (cell.f) {
        row.push(`=${cell.f}`);
        continue;
      }
      if (cell.v === undefined || cell.v === null) {
        row.push(null);
        continue;
      }
      row.push(cell.v as string | number | boolean);
    }
    rows.push(row);
  }
  return rows;
}

function evaluateWorkbook(workbook: XLSX.WorkBook) {
  const sheetData: Record<string, (string | number | boolean | null)[][]> = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    sheetData[name] = sheetToGrid(sheet);
  }

  const hf = HyperFormula.buildFromSheets(sheetData, {
    licenseKey: "gpl-v3",
  });

  const values: Record<string, (string | number | boolean | null)[][]> = {};
  for (const name of workbook.SheetNames) {
    values[name] = hf.getSheetValues(name) as (string | number | boolean | null)[][];
  }
  return values;
}

router.post("/excel/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  ensureStorageDir();
  fs.writeFileSync(STORAGE_FILE, req.file.buffer);

  const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
  res.json({
    sheets: workbook.SheetNames,
  });
});

router.get("/excel/sheets", (_req, res) => {
  try {
    const workbook = loadWorkbook();
    res.json({ sheets: workbook.SheetNames });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/excel/sheet", (req, res) => {
  const name = String(req.query.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing sheet name" });
    return;
  }

  try {
    const workbook = loadWorkbook();
    if (!workbook.Sheets[name]) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    const evaluated = evaluateWorkbook(workbook);
    const rows = evaluated[name] ?? [];
    res.json({ name, rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
