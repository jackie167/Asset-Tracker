import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const STORAGE_DIR = path.resolve(process.cwd(), "api-server", "data");
const STORAGE_FILE = path.join(STORAGE_DIR, "excel-source.xlsx");
const DEFAULT_SOURCE = path.resolve(process.cwd(), "api-server", "data", "excel-source.xlsx");

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
  return XLSX.readFile(candidate, { cellDates: true });
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
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }) as (string | number | null)[][];

    res.json({ name, rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
