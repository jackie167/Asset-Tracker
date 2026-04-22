import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, holdingsTable } from "../../../lib/db/src/index.ts";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const STORAGE_DIR = path.resolve(process.cwd(), "data");
const STORAGE_FILE = path.join(STORAGE_DIR, "excel-source.xlsx");
const DEFAULT_SOURCE = path.join(STORAGE_DIR, "excel-source.xlsx");
const CALCULATED_FILE = path.join(STORAGE_DIR, "excel-source-calculated.xlsx");
const TMP_INPUT = path.join(STORAGE_DIR, "excel-source-input.xlsx");
const EXCEL_EXPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ExcelSourceInfo = {
  mode: "local" | "google_drive";
  readOnly: boolean;
  label: string;
};

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function getGoogleDriveConfig() {
  const fileId = String(process.env["GOOGLE_DRIVE_FILE_ID"] ?? "").trim();
  const clientEmail = String(process.env["GOOGLE_SERVICE_ACCOUNT_EMAIL"] ?? "").trim();
  const privateKey = String(process.env["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"] ?? "")
    .replace(/\\n/g, "\n")
    .trim();

  if (!fileId || !clientEmail || !privateKey) return null;

  return {
    fileId,
    clientEmail,
    privateKey,
    tokenUri: "https://oauth2.googleapis.com/token",
  };
}

function getExcelSourceInfo(): ExcelSourceInfo {
  const driveConfig = getGoogleDriveConfig();
  if (driveConfig) {
    return {
      mode: "google_drive",
      readOnly: true,
      label: "Google Drive",
    };
  }

  return {
    mode: "local",
    readOnly: false,
    label: "Local file",
  };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGoogleDriveAccessToken() {
  const config = getGoogleDriveConfig();
  if (!config) {
    throw new Error("Google Drive source is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: config.tokenUri,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claimSet));
  const unsignedToken = `${encodedHeader}.${encodedClaims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(config.privateKey);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch(config.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Could not get Google access token: ${response.status} ${text.slice(0, 200)}`);
  }

  const json = await response.json() as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Google token response is missing access_token.");
  }

  return json.access_token;
}

async function fetchWorkbookBufferFromGoogleDrive(): Promise<Buffer> {
  const config = getGoogleDriveConfig();
  if (!config) {
    throw new Error("Google Drive source is not configured.");
  }

  const accessToken = await getGoogleDriveAccessToken();
  const metadataResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.fileId)}?fields=id,name,mimeType`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metadataResponse.ok) {
    const text = await metadataResponse.text();
    throw new Error(`Could not read Google Drive file metadata: ${metadataResponse.status} ${text.slice(0, 200)}`);
  }

  const metadata = await metadataResponse.json() as { mimeType?: string; name?: string };
  const mimeType = metadata.mimeType ?? "";
  const isGoogleSheet = mimeType === "application/vnd.google-apps.spreadsheet";
  const downloadUrl = isGoogleSheet
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.fileId)}/export?mimeType=${encodeURIComponent(EXCEL_EXPORT_MIME)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.fileId)}?alt=media`;

  const fileResponse = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!fileResponse.ok) {
    const text = await fileResponse.text();
    throw new Error(`Could not download Google Drive Excel source: ${fileResponse.status} ${text.slice(0, 200)}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function loadWorkbook(): Promise<XLSX.WorkBook> {
  const driveConfig = getGoogleDriveConfig();
  if (driveConfig) {
    const buffer = await fetchWorkbookBufferFromGoogleDrive();
    return XLSX.read(buffer, { type: "buffer", cellDates: true });
  }

  const source = fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : DEFAULT_SOURCE;
  if (!fs.existsSync(source)) {
    throw new Error("No Excel file available");
  }
  const candidate = maybeRecalculateWithLibreOffice(source);
  const buffer = fs.readFileSync(candidate);
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

function saveWorkbook(workbook: XLSX.WorkBook): void {
  ensureStorageDir();
  XLSX.writeFile(workbook, STORAGE_FILE);
  if (fs.existsSync(CALCULATED_FILE)) {
    fs.unlinkSync(CALCULATED_FILE);
  }
}

function parseVNNumber(value: string | number | boolean | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value ? 1 : 0;

  const s = String(value).trim().replace(/\s/g, "");
  if (!s) return undefined;

  if (s.includes(",") && s.includes(".")) {
    const parsed = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (s.includes(",")) {
    const parsed = parseFloat(s.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (s.includes(".")) {
    const parts = s.split(".");
    if (parts.length > 2) {
      const parsed = parseFloat(parts.join(""));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (parts[0] !== "0" && parts[1]?.length === 3) {
      const parsed = parseFloat(parts[0] + parts[1]);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }

  const parsed = parseFloat(s);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type InvestmentRow = {
  symbol: string;
  type: string;
  quantity: number;
  manualPrice: number | null;
};

function isInvestmentSheetName(name: string): boolean {
  return name.trim().toLowerCase().startsWith("investment");
}

function normalizeSheetLookupName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function resolveWorkbookSheetName(workbook: XLSX.WorkBook, requestedName: string): string | null {
  if (workbook.Sheets[requestedName]) return requestedName;

  const trimmed = requestedName.trim();
  if (trimmed && workbook.Sheets[trimmed]) return trimmed;

  const normalizedRequested = normalizeSheetLookupName(requestedName);
  if (!normalizedRequested) return null;

  return (
    workbook.SheetNames.find((sheetName) => normalizeSheetLookupName(sheetName) === normalizedRequested) ??
    null
  );
}

function resolveInvestmentSheetName(workbook: XLSX.WorkBook): string {
  const exact = workbook.SheetNames.find((name) => name.trim().toLowerCase() === "investment");
  if (exact) return exact;

  const prefixed = workbook.SheetNames.find((name) => isInvestmentSheetName(name));
  if (prefixed) return prefixed;

  throw new Error('Không tìm thấy sheet Investment trong file Excel.');
}

function shouldSyncManualPrice(type: string): boolean {
  return type !== "stock" && type !== "gold" && type !== "crypto";
}

function normalizeHeaderName(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeInvestmentType(rawType: string | number | boolean | null | undefined): string {
  const typeText = String(rawType ?? "").trim().toLowerCase();
  if (!typeText) return "other";

  const normalized = normalizeHeaderName(typeText);
  if (!normalized || normalized === "n_a") return "other";

  const aliases: Record<string, string> = {
    stock: "stock",
    equity: "stock",
    co_phieu: "stock",
    bond: "bond",
    trai_phieu: "bond",
    fund: "fund",
    funds: "fund",
    quy: "fund",
    quy_mo: "fund",
    ccq: "fund",
    crypto: "crypto",
    tien_ma_hoa: "crypto",
    gold: "gold",
    vang: "gold",
    cash: "cash",
    tien_mat: "cash",
    real_estate: "real_estate",
    bat_dong_san: "real_estate",
    other: "other",
  };

  return aliases[normalized] ?? normalized ?? "other";
}

function parseInvestmentRows(workbook: XLSX.WorkBook, sheetName = "Investment"): InvestmentRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
    header: 1,
    defval: "",
  });

  const headerIndex = rows.findIndex((row) => {
    const firstCell = normalizeHeaderName(row[0]);
    return firstCell === "tai_san" || firstCell === "asset" || firstCell === "symbol";
  });

  if (headerIndex === -1) {
    throw new Error(`Sheet "${sheetName}" does not contain a valid header row`);
  }

  const header = rows[headerIndex].map((cell) => normalizeHeaderName(cell));
  const assetIndex = header.findIndex((value) => value === "tai_san" || value === "symbol" || value === "asset");
  const typeIndex = header.findIndex((value) => value === "loai" || value === "type");
  const currentIndex = header.findIndex((value) => value === "current" || value === "current_value");
  const quantityIndex = header.findIndex((value) => value === "ql" || value === "qi" || value === "quantity");
  const currentPriceIndex = header.findIndex((value) => value === "current_price" || value === "price");

  if (assetIndex === -1 || quantityIndex === -1) {
    throw new Error(`Sheet "${sheetName}" is missing required columns`);
  }

  const parsedRows: InvestmentRow[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const symbol = String(row[assetIndex] ?? "").trim().toUpperCase();
    if (!symbol) continue;

    const type = normalizeInvestmentType(typeIndex >= 0 ? row[typeIndex] : "");
    const parsedCurrentValue =
      currentIndex >= 0 ? (parseVNNumber(row[currentIndex]) ?? null) : null;
    const parsedCurrentPrice =
      currentPriceIndex >= 0 ? (parseVNNumber(row[currentPriceIndex]) ?? null) : null;
    let quantity = parseVNNumber(row[quantityIndex]);

    if ((quantity == null || quantity <= 0) && shouldSyncManualPrice(type) && parsedCurrentValue != null && parsedCurrentValue > 0) {
      quantity = 1;
    }

    if (quantity == null || quantity <= 0) continue;

    const derivedCurrentPrice =
      parsedCurrentPrice != null
        ? parsedCurrentPrice
        : parsedCurrentValue != null && quantity > 0
          ? parsedCurrentValue / quantity
          : null;
    const manualPrice = shouldSyncManualPrice(type) ? derivedCurrentPrice : null;

    parsedRows.push({
      symbol,
      type,
      quantity,
      manualPrice,
    });
  }

  return parsedRows;
}

type ExcelOverrides = Record<string, string | number | null>;

function applyOverrides(workbook: XLSX.WorkBook, sheetName: string, overrides: ExcelOverrides | undefined): void {
  if (!overrides || !Object.keys(overrides).length) return;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (const key of Object.keys(overrides)) {
    const [rStr, cStr] = key.split(",");
    const rOffset = Number(rStr);
    const cOffset = Number(cStr);
    if (!Number.isFinite(rOffset) || !Number.isFinite(cOffset)) continue;
    const r = range.s.r + rOffset;
    const c = range.s.c + cOffset;
    const addr = XLSX.utils.encode_cell({ r, c });
    const existing = sheet[addr] as XLSX.CellObject | undefined;
    if (existing?.f) continue;
    const value = overrides[key];
    if (value === null || value === "") {
      delete sheet[addr];
      continue;
    }
    if (typeof value === "number") {
      sheet[addr] = { t: "n", v: value };
    } else {
      sheet[addr] = { t: "s", v: String(value) };
    }
  }
}

function maybeRecalculateWithLibreOffice(sourcePath: string): string {
  const useLibre = String(process.env.EXCEL_USE_LIBREOFFICE ?? "").toLowerCase();
  if (!(useLibre === "1" || useLibre === "true" || useLibre === "yes")) {
    return sourcePath;
  }

  try {
    ensureStorageDir();
    const force = String(process.env.EXCEL_RECALC_FORCE ?? "").toLowerCase();
    const shouldForce = force === "1" || force === "true" || force === "yes";
    const sourceStat = fs.statSync(sourcePath);
    if (!shouldForce && fs.existsSync(CALCULATED_FILE)) {
      const calcStat = fs.statSync(CALCULATED_FILE);
      if (calcStat.mtimeMs >= sourceStat.mtimeMs) {
        return CALCULATED_FILE;
      }
    }

    fs.copyFileSync(sourcePath, TMP_INPUT);
    execFileSync("soffice", ["--headless", "--convert-to", "xlsx", "--outdir", STORAGE_DIR, TMP_INPUT], {
      stdio: "ignore",
    });
    const generated = path.join(STORAGE_DIR, path.basename(TMP_INPUT));
    if (fs.existsSync(CALCULATED_FILE)) {
      fs.unlinkSync(CALCULATED_FILE);
    }
    if (fs.existsSync(generated)) {
      fs.renameSync(generated, CALCULATED_FILE);
    }
    if (fs.existsSync(TMP_INPUT)) {
      fs.unlinkSync(TMP_INPUT);
    }
    return fs.existsSync(CALCULATED_FILE) ? CALCULATED_FILE : sourcePath;
  } catch {
    if (fs.existsSync(TMP_INPUT)) {
      fs.unlinkSync(TMP_INPUT);
    }
    return sourcePath;
  }
}

type CellValue = string | number | boolean | null;
type RawCellValue = CellValue | Date | Record<string, unknown>;

function normalizeCellValue(value: RawCellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("value" in value && typeof value.value === "string") {
      return value.value;
    }
    if ("message" in value && typeof value.message === "string") {
      return value.message;
    }
    if ("type" in value && typeof value.type === "string") {
      return value.type;
    }
    return JSON.stringify(value);
  }
  return null;
}

function sheetToValueGrid(sheet: XLSX.WorkSheet): CellValue[][] {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return [];

  const rows: CellValue[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: CellValue[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellRef] as XLSX.CellObject | undefined;
      if (!cell || cell.v === undefined || cell.v === null) {
        row.push(null);
        continue;
      }
      row.push(cell.v as string | number | boolean);
    }
    rows.push(row);
  }
  return rows;
}

function sheetFormulaText(sheet: XLSX.WorkSheet): string[][] {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return [];

  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellRef] as XLSX.CellObject | undefined;
      row.push(cell?.f ? `=${cell.f}` : "");
    }
    rows.push(row);
  }
  return rows;
}

type WorkbookMap = Record<string, XLSX.WorkSheet>;
type EvalContext = {
  workbook: WorkbookMap;
  memo: Map<string, CellValue>;
  visiting: Set<string>;
};

function getCellValue(ctx: EvalContext, sheetName: string, addr: string): CellValue {
  const key = `${sheetName}!${addr}`;
  if (ctx.memo.has(key)) return ctx.memo.get(key) ?? null;
  if (ctx.visiting.has(key)) {
    const fallback = ctx.workbook[sheetName]?.[addr] as XLSX.CellObject | undefined;
    const value = fallback?.v ?? null;
    ctx.memo.set(key, value as CellValue);
    return value as CellValue;
  }
  ctx.visiting.add(key);
  const sheet = ctx.workbook[sheetName];
  const cell = sheet?.[addr] as XLSX.CellObject | undefined;
  let value: CellValue = null;
  if (!cell) {
    value = null;
  } else if (cell.f) {
    value = evaluateFormula(ctx, sheetName, cell.f);
  } else if (cell.v !== undefined && cell.v !== null) {
    value = cell.v as CellValue;
  }
  ctx.memo.set(key, value);
  ctx.visiting.delete(key);
  return value;
}

type Token =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" }
  | { type: "colon" }
  | { type: "bang" };

function tokenizeFormula(input: string): Token[] {
  const s = input.trim();
  const tokens: Token[] = [];
  let i = 0;
  const pushOp = (value: string) => tokens.push({ type: "op", value });

  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ type: "colon" });
      i++;
      continue;
    }
    if (ch === "!") {
      tokens.push({ type: "bang" });
      i++;
      continue;
    }
    if (ch === "'" ) {
      let j = i + 1;
      let value = "";
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") {
          value += "'";
          j += 2;
          continue;
        }
        if (s[j] === "'") break;
        value += s[j];
        j++;
      }
      tokens.push({ type: "string", value });
      i = j + 1;
      continue;
    }
    if (ch === "\"" ) {
      let j = i + 1;
      let value = "";
      while (j < s.length && s[j] !== "\"") {
        value += s[j];
        j++;
      }
      tokens.push({ type: "string", value });
      i = j + 1;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      pushOp(two);
      i += 2;
      continue;
    }
    if ("+-*/^=<>".includes(ch)) {
      pushOp(ch);
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9" || ch === ".") {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      tokens.push({ type: "number", value: num });
      i = j;
      if (s[i] === "%") {
        tokens.push({ type: "op", value: "%" });
        i++;
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_.$]/.test(s[j])) j++;
      tokens.push({ type: "ident", value: s.slice(i, j) });
      i = j;
      continue;
    }
    i++;
  }
  return tokens;
}

function parseCellRef(ref: string): string {
  return ref.replace(/\$/g, "");
}

function parseRange(start: string, end: string): string[] {
  const s = XLSX.utils.decode_cell(parseCellRef(start));
  const e = XLSX.utils.decode_cell(parseCellRef(end));
  const addrs: string[] = [];
  for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r); r++) {
    for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++) {
      addrs.push(XLSX.utils.encode_cell({ r, c }));
    }
  }
  return addrs;
}

function evaluateFormula(ctx: EvalContext, sheetName: string, formula: string): CellValue {
  const tokens = tokenizeFormula(formula);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const parsePrimary = (): any => {
    const t = peek();
    if (!t) return null;
    if (t.type === "number") {
      next();
      return t.value;
    }
    if (t.type === "string") {
      next();
      const after = peek();
      if (after && after.type === "bang") {
        next();
        const refToken = next();
        if (refToken?.type === "ident") {
          const ref = parseCellRef(refToken.value);
          if (peek() && peek().type === "colon") {
            next();
            const end = next();
            if (end?.type === "ident") {
              return parseRange(ref, end.value).map((addr) => getCellValue(ctx, t.value, addr));
            }
          }
          return getCellValue(ctx, t.value, ref);
        }
      }
      return t.value;
    }
    if (t.type === "ident") {
      const ident = t.value;
      next();
      const after = peek();
      if (after && after.type === "paren" && after.value === "(") {
        next();
        const args: any[] = [];
        if (peek() && !(peek().type === "paren" && peek().value === ")")) {
          while (true) {
            args.push(parseExpression());
            if (peek() && peek().type === "comma") {
              next();
              continue;
            }
            break;
          }
        }
        if (peek() && peek().type === "paren" && peek().value === ")") next();
        return evaluateFunction(ctx, sheetName, ident, args);
      }
      if (after && after.type === "bang") {
        next();
        const refToken = next();
        if (refToken?.type === "ident") {
          const ref = parseCellRef(refToken.value);
          if (peek() && peek().type === "colon") {
            next();
            const end = next();
            if (end?.type === "ident") {
              return parseRange(ref, end.value).map((addr) => getCellValue(ctx, ident, addr));
            }
          }
          return getCellValue(ctx, ident, ref);
        }
      }
      if (after && after.type === "colon") {
        next();
        const end = next();
        if (end?.type === "ident") {
          return parseRange(ident, end.value).map((addr) => getCellValue(ctx, sheetName, addr));
        }
      }
      return getCellValue(ctx, sheetName, parseCellRef(ident));
    }
    if (t.type === "paren" && t.value === "(") {
      next();
      const expr = parseExpression();
      if (peek() && peek().type === "paren" && peek().value === ")") next();
      return expr;
    }
    return null;
  };

  const parseUnary = (): any => {
    const t = peek();
    if (t && t.type === "op" && (t.value === "+" || t.value === "-")) {
      next();
      const v = parseUnary();
      return t.value === "-" ? -Number(v || 0) : Number(v || 0);
    }
    return parsePrimary();
  };

  const parsePercent = (): any => {
    let v = parseUnary();
    while (peek() && peek().type === "op" && peek().value === "%") {
      next();
      v = Number(v || 0) / 100;
    }
    return v;
  };

  const parseMulDiv = (): any => {
    let v = parsePercent();
    while (peek() && peek().type === "op" && (peek() as any).value && "*/".includes((peek() as any).value)) {
      const op = (next() as any).value;
      const right = parsePercent();
      v = op === "*" ? Number(v || 0) * Number(right || 0) : Number(v || 0) / Number(right || 0);
    }
    return v;
  };

  const parseAddSub = (): any => {
    let v = parseMulDiv();
    while (peek() && peek().type === "op" && "+-".includes((peek() as any).value)) {
      const op = (next() as any).value;
      const right = parseMulDiv();
      v = op === "+" ? Number(v || 0) + Number(right || 0) : Number(v || 0) - Number(right || 0);
    }
    return v;
  };

  const parseCompare = (): any => {
    const v = parseAddSub();
    const t = peek();
    if (t && t.type === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.value)) {
      const op = (next() as any).value;
      const right = parseAddSub();
      switch (op) {
        case "=": return v == right;
        case "<>": return v != right;
        case "<": return Number(v) < Number(right);
        case ">": return Number(v) > Number(right);
        case "<=": return Number(v) <= Number(right);
        case ">=": return Number(v) >= Number(right);
      }
    }
    return v;
  };

  const parseExpression = (): any => parseCompare();

  const result = parseExpression();
  return normalizeCellValue(result as RawCellValue);
}

function flattenValues(input: any): number[] {
  if (Array.isArray(input)) {
    return input.flatMap((v) => flattenValues(v));
  }
  if (input === null || input === undefined || input === "") return [];
  const num = Number(input);
  return Number.isFinite(num) ? [num] : [];
}

function evaluateFunction(ctx: EvalContext, sheetName: string, fn: string, args: any[]): any {
  const name = fn.toUpperCase();
  if (name === "SUM") {
    return args.flatMap((a) => flattenValues(a)).reduce((a, b) => a + b, 0);
  }
  if (name === "IF") {
    const [cond, t, f] = args;
    return cond ? t : f;
  }
  if (name === "SUMIF") {
    const range = args[0];
    const criteria = args[1];
    const sumRange = args[2] ?? range;
    const rVals = Array.isArray(range) ? range : [range];
    const sVals = Array.isArray(sumRange) ? sumRange : [sumRange];
    const opMatch = typeof criteria === "string" ? criteria.match(/^(<=|>=|<>|=|<|>)(.*)$/) : null;
    const op = opMatch ? opMatch[1] : "=";
    const rhsRaw = opMatch ? opMatch[2] : criteria;
    const rhsNum = Number(rhsRaw);
    const rhs = Number.isFinite(rhsNum) ? rhsNum : rhsRaw;
    let sum = 0;
    for (let i = 0; i < rVals.length; i++) {
      const left = rVals[i];
      let ok = false;
      if (typeof rhs === "number") {
        const leftNum = Number(left);
        if (!Number.isFinite(leftNum)) ok = false;
        else {
          if (op === "=") ok = leftNum === rhs;
          else if (op === "<>") ok = leftNum !== rhs;
          else if (op === "<") ok = leftNum < rhs;
          else if (op === ">") ok = leftNum > rhs;
          else if (op === "<=") ok = leftNum <= rhs;
          else if (op === ">=") ok = leftNum >= rhs;
        }
      } else {
        const leftStr = String(left ?? "");
        const rightStr = String(rhs ?? "");
        if (op === "=") ok = leftStr === rightStr;
        else if (op === "<>") ok = leftStr !== rightStr;
        else ok = false;
      }
      if (ok) {
        const v = Number(sVals[i] ?? 0);
        if (Number.isFinite(v)) sum += v;
      }
    }
    return sum;
  }
  return null;
}

function sheetFormulaMask(sheet: XLSX.WorkSheet): boolean[][] {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return [];

  const rows: boolean[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: boolean[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellRef] as XLSX.CellObject | undefined;
      row.push(Boolean(cell?.f));
    }
    rows.push(row);
  }
  return rows;
}

function evaluateWorkbook(workbook: XLSX.WorkBook) {
  const formulaMask: Record<string, boolean[][]> = {};
  const formulaText: Record<string, string[][]> = {};
  const sourceValues: Record<string, CellValue[][]> = {};
  const workbookMap: WorkbookMap = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    formulaMask[name] = sheetFormulaMask(sheet);
    formulaText[name] = sheetFormulaText(sheet);
    sourceValues[name] = sheetToValueGrid(sheet);
    workbookMap[name] = sheet;
  }
  const ctx: EvalContext = { workbook: workbookMap, memo: new Map(), visiting: new Set() };
  const values: Record<string, CellValue[][]> = {};
  const errors: Record<string, string[][]> = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
    if (!range) {
      values[name] = [];
      errors[name] = [];
      continue;
    }
    const rows: CellValue[][] = [];
    const errRows: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: CellValue[] = [];
      const errRow: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr] as XLSX.CellObject | undefined;
        if (cell?.f) {
          const v = getCellValue(ctx, name, addr);
          row.push(v);
          errRow.push("");
        } else if (cell?.v !== undefined && cell?.v !== null) {
          row.push(cell.v as CellValue);
          errRow.push("");
        } else {
          row.push(null);
          errRow.push("");
        }
      }
      rows.push(row);
      errRows.push(errRow);
    }
    values[name] = rows;
    errors[name] = errRows;
  }
  return { values, formulaMask, formulaText, errors };
}

router.post("/excel/upload", upload.single("file"), (req, res) => {
  const sourceInfo = getExcelSourceInfo();
  if (sourceInfo.mode === "google_drive") {
    res.status(409).json({ error: "Excel source đang lấy từ Google Drive. Hãy cập nhật file trên Drive." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  ensureStorageDir();
  fs.writeFileSync(STORAGE_FILE, req.file.buffer);

  const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
  res.json({
    sheets: workbook.SheetNames,
    source: sourceInfo,
  });
});

router.get("/excel/sheets", async (_req, res) => {
  try {
    const workbook = await loadWorkbook();
    res.json({ sheets: workbook.SheetNames, source: getExcelSourceInfo() });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/excel/sheet", async (req, res) => {
  const name = String(req.query.name ?? "").trim();
  const debug = String(req.query.debug ?? "").toLowerCase();
  const isDebug = debug === "1" || debug === "true" || debug === "yes";
  if (!name) {
    res.status(400).json({ error: "Missing sheet name" });
    return;
  }

  try {
    const workbook = await loadWorkbook();
    const resolvedName = resolveWorkbookSheetName(workbook, name);
    if (!resolvedName) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    const evaluated = evaluateWorkbook(workbook);
    const rows = evaluated.values[resolvedName] ?? [];
    const formulas = evaluated.formulaMask[resolvedName] ?? [];
    const sourceInfo = getExcelSourceInfo();
    if (isDebug) {
      const formulaText = evaluated.formulaText[resolvedName] ?? [];
      const errors = evaluated.errors[resolvedName] ?? [];
      res.json({ name: resolvedName, rows, formulas, debug: { formulaText, errors }, source: sourceInfo });
      return;
    }
    res.json({ name: resolvedName, rows, formulas, source: sourceInfo });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/excel/sheet/recalc", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const overrides = req.body?.overrides as ExcelOverrides | undefined;
  if (!name) {
    res.status(400).json({ error: "Missing sheet name" });
    return;
  }

  try {
    const workbook = await loadWorkbook();
    const resolvedName = resolveWorkbookSheetName(workbook, name);
    if (!resolvedName) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    applyOverrides(workbook, resolvedName, overrides);
    const evaluated = evaluateWorkbook(workbook);
    const rows = evaluated.values[resolvedName] ?? [];
    const formulas = evaluated.formulaMask[resolvedName] ?? [];
    res.json({ name: resolvedName, rows, formulas, source: getExcelSourceInfo() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/excel/sheet/update", async (req, res) => {
  const sourceInfo = getExcelSourceInfo();
  if (sourceInfo.mode === "google_drive") {
    res.status(409).json({ error: "Excel source đang lấy từ Google Drive. Hãy chỉnh file trên Drive." });
    return;
  }

  const name = String(req.body?.name ?? "").trim();
  const overrides = req.body?.overrides as ExcelOverrides | undefined;
  if (!name) {
    res.status(400).json({ error: "Missing sheet name" });
    return;
  }

  try {
    const workbook = await loadWorkbook();
    const resolvedName = resolveWorkbookSheetName(workbook, name);
    if (!resolvedName) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    applyOverrides(workbook, resolvedName, overrides);
    saveWorkbook(workbook);
    const evaluated = evaluateWorkbook(workbook);
    const rows = evaluated.values[resolvedName] ?? [];
    const formulas = evaluated.formulaMask[resolvedName] ?? [];
    res.json({ name: resolvedName, rows, formulas, source: sourceInfo });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/excel/investment/sync", async (req, res): Promise<void> => {
  try {
    const workbook = await loadWorkbook();
    const requestedSheetName = String(req.body?.name ?? "").trim();
    const overrides = req.body?.overrides as ExcelOverrides | undefined;
    const investmentSheetName = requestedSheetName
      ? (resolveWorkbookSheetName(workbook, requestedSheetName) ?? requestedSheetName)
      : resolveInvestmentSheetName(workbook);

    if (!workbook.Sheets[investmentSheetName]) {
      res.status(404).json({ error: `Sheet "${investmentSheetName}" không tồn tại.` });
      return;
    }

    applyOverrides(workbook, investmentSheetName, overrides);
    const rows = parseInvestmentRows(workbook, investmentSheetName);

    if (rows.length === 0) {
      res.status(400).json({ error: `Sheet "${investmentSheetName}" không có dòng dữ liệu hợp lệ để sync.` });
      return;
    }

    const existingHoldings = await db.select().from(holdingsTable);
    const existingBySymbol = new Map(existingHoldings.map((holding) => [holding.symbol.toUpperCase(), holding]));
    const syncedSymbols = new Set(rows.map((row) => row.symbol));

    let created = 0;
    let updated = 0;
    let removed = 0;
    const skipped: string[] = [];

    for (const row of rows) {
      const existing = existingBySymbol.get(row.symbol);

      if (existing) {
        await db
          .update(holdingsTable)
          .set({
            type: row.type,
            quantity: String(row.quantity),
            manualPrice: shouldSyncManualPrice(row.type)
              ? row.manualPrice != null
                ? String(row.manualPrice)
                : null
              : null,
            updatedAt: new Date(),
          })
          .where(eq(holdingsTable.id, existing.id));
        updated += 1;
        continue;
      }

      await db.insert(holdingsTable).values({
        symbol: row.symbol,
        type: row.type,
        quantity: String(row.quantity),
        manualPrice: shouldSyncManualPrice(row.type)
          ? row.manualPrice != null
            ? String(row.manualPrice)
            : null
          : null,
      });
      created += 1;
    }

    for (const holding of existingHoldings) {
      if (syncedSymbols.has(holding.symbol.toUpperCase())) continue;
      await db.delete(holdingsTable).where(eq(holdingsTable.id, holding.id));
      removed += 1;
    }

    res.json({
      success: true,
      sheet: investmentSheetName,
      total: rows.length,
      created,
      updated,
      removed,
      skipped,
      message: `Đã sync ${rows.length} dòng từ "${investmentSheetName}" sang Tài sản.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể sync sheet Investment.";
    res.status(500).json({ error: message });
  }
});

export default router;
