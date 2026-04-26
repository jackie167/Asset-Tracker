import { Router, type IRouter } from "express";
import * as XLSX from "xlsx";
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, holdingsTable, transactionsTable } from "../../../lib/db/src/index.ts";

const router: IRouter = Router();

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

// ── In-memory caches ────────────────────────────────────────────────────────
let _tokenCache: { token: string; expiresAt: number } | null = null;
let _workbookCache: { workbook: XLSX.WorkBook; expiresAt: number } | null = null;
const WORKBOOK_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _sheetsCache = new Map<string, { rows: unknown[][]; expiresAt: number }>();

// Returns true if the Drive file is a native Google Sheet (not an uploaded xlsx)
// Re-checks every 10 minutes in case file was converted
let _isNativeSheet: boolean | null = null;
let _isNativeSheetCheckedAt = 0;

async function isNativeGoogleSheet(): Promise<boolean> {
  const now = Date.now();
  if (_isNativeSheet !== null && now - _isNativeSheetCheckedAt < 10 * 60 * 1000) return _isNativeSheet;
  _isNativeSheetCheckedAt = now;
  const config = getGoogleDriveConfig();
  if (!config) { _isNativeSheet = false; return false; }
  try {
    const token = await getGoogleDriveAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.fileId)}?fields=mimeType`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) { _isNativeSheet = false; return false; }
    const { mimeType } = await res.json() as { mimeType?: string };
    _isNativeSheet = mimeType === "application/vnd.google-apps.spreadsheet";
  } catch {
    _isNativeSheet = false;
  }
  return _isNativeSheet;
}

async function getGoogleSheetsValues(sheetName: string): Promise<unknown[][]> {
  const config = getGoogleDriveConfig();
  if (!config) return [];

  const cached = _sheetsCache.get(sheetName);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const token = await getGoogleDriveAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.fileId)}/values/${encodeURIComponent(sheetName)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { values?: unknown[][] };
  const rows = data.values ?? [];
  _sheetsCache.set(sheetName, { rows, expiresAt: Date.now() + WORKBOOK_TTL_MS });
  return rows;
}

function colToLetter(col: number): string {
  let letter = "";
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

async function writeGoogleSheetsCell(sheetName: string, rowIndex: number, colIndex: number, value: unknown): Promise<void> {
  const config = getGoogleDriveConfig();
  if (!config) throw new Error("Google Sheets not configured");
  const token = await getGoogleDriveAccessToken();
  const cellAddr = `${sheetName}!${colToLetter(colIndex)}${rowIndex + 1}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.fileId)}/values/${encodeURIComponent(cellAddr)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[value]] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets write error ${res.status}: ${text.slice(0, 200)}`);
  }
  _sheetsCache.delete(sheetName);
}

async function getGoogleSheetNames(): Promise<string[]> {
  const config = getGoogleDriveConfig();
  if (!config) return [];

  const token = await getGoogleDriveAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.fileId)}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { sheets?: { properties: { title: string } }[] };
  return data.sheets?.map((s) => s.properties.title) ?? [];
}

async function getGoogleDriveAccessToken() {
  const config = getGoogleDriveConfig();
  if (!config) {
    throw new Error("Google Drive source is not configured.");
  }

  // Return cached token if still valid (with 2-minute buffer)
  const nowMs = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > nowMs + 2 * 60 * 1000) {
    return _tokenCache.token;
  }

  const now = Math.floor(nowMs / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly",
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

  // Cache token for 55 minutes
  _tokenCache = { token: json.access_token, expiresAt: nowMs + 55 * 60 * 1000 };
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
    const nowMs = Date.now();
    if (_workbookCache && _workbookCache.expiresAt > nowMs) {
      return _workbookCache.workbook;
    }
    const buffer = await fetchWorkbookBufferFromGoogleDrive();
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    _workbookCache = { workbook, expiresAt: nowMs + WORKBOOK_TTL_MS };
    return workbook;
  }

  const source = fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : DEFAULT_SOURCE;
  if (!fs.existsSync(source)) {
    throw new Error("No Excel file available");
  }
  const candidate = maybeRecalculateWithLibreOffice(source);
  const buffer = fs.readFileSync(candidate);
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
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
  costOfCapital: number | null;
  interest: number | null;
};

type TransactionImportRow = {
  side: "buy" | "sell";
  fundingSource: string;
  assetType: string;
  symbol: string;
  quantity: number;
  totalValue: number;
  unitPrice: number;
  realizedInterest: number;
  note: string | null;
  executedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function isInvestmentSheetName(name: string): boolean {
  return name.trim().toLowerCase().startsWith("investment");
}

function isTransactionsSheetName(name: string): boolean {
  const normalized = normalizeHeaderName(name);
  return normalized === "transactions" || normalized.startsWith("transactions_");
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

function parseInvestmentRowsFromRaw(rows: unknown[][]): InvestmentRow[] {

  const headerIndex = rows.findIndex((row) => {
    const firstCell = normalizeHeaderName(row[0] as string | number | boolean | null);
    return firstCell === "tai_san" || firstCell === "asset" || firstCell === "symbol";
  });

  if (headerIndex === -1) {
    throw new Error(`Investment sheet does not contain a valid header row`);
  }

  const header = rows[headerIndex].map((cell) => normalizeHeaderName(cell as string | number | boolean | null));
  const assetIndex = header.findIndex((value) => value === "tai_san" || value === "symbol" || value === "asset");
  const typeIndex = header.findIndex((value) => value === "loai" || value === "type");
  const currentIndex = header.findIndex((value) => value === "current" || value === "current_value");
  const interestIndex = header.findIndex((value) => value === "interest");
  const costOfCapitalIndex = header.findIndex((value) => value === "cost_of_capital");
  const quantityIndex = header.findIndex((value) => value === "ql" || value === "qi" || value === "quantity");
  const currentPriceIndex = header.findIndex((value) => value === "current_price" || value === "price");

  if (assetIndex === -1 || quantityIndex === -1) {
    throw new Error(`Investment sheet is missing required columns (asset/symbol, quantity)`);
  }

  const parsedRows: InvestmentRow[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const symbol = String(row[assetIndex] ?? "").trim().toUpperCase();
    if (!symbol) continue;

    const cell = (i: number) => row[i] as string | number | boolean | null;
    const type = normalizeInvestmentType(typeIndex >= 0 ? cell(typeIndex) : "");
    const parsedCurrentValue =
      currentIndex >= 0 ? (parseVNNumber(cell(currentIndex)) ?? null) : null;
    const parsedInterest =
      interestIndex >= 0 ? (parseVNNumber(cell(interestIndex)) ?? null) : null;
    const parsedCostOfCapital =
      costOfCapitalIndex >= 0 ? (parseVNNumber(cell(costOfCapitalIndex)) ?? null) : null;
    const parsedCurrentPrice =
      currentPriceIndex >= 0 ? (parseVNNumber(cell(currentPriceIndex)) ?? null) : null;
    let quantity = parseVNNumber(cell(quantityIndex));

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
      costOfCapital: parsedCostOfCapital,
      interest: parsedInterest,
    });
  }

  return parsedRows;
}

function parseInvestmentRows(workbook: XLSX.WorkBook, sheetName = "Investment"): InvestmentRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  return parseInvestmentRowsFromRaw(rows as unknown[][]);
}

function parseDateCell(value: string | number | boolean | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H ?? 0, parsed.M ?? 0, parsed.S ?? 0));
  }

  const text = String(value).trim();
  if (!text) return null;

  const vnDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (vnDate) {
    const day = Number(vnDate[1]);
    const month = Number(vnDate[2]);
    const rawYear = Number(vnDate[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const hour = Number(vnDate[4] ?? 0);
    const minute = Number(vnDate[5] ?? 0);
    const second = Number(vnDate[6] ?? 0);
    const date = new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTransactionRowsFromRaw(rows: unknown[][]): TransactionImportRow[] {
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeaderName(cell as string | number | boolean | null));
    return normalized.includes("side") && (normalized.includes("asset") || normalized.includes("symbol"));
  });

  if (headerIndex === -1) {
    throw new Error(`Transactions sheet does not contain a valid header row`);
  }

  const header = rows[headerIndex].map((cell) => normalizeHeaderName(cell as string | number | boolean | null));
  const sideIndex = header.findIndex((value) => value === "side");
  const assetIndex = header.findIndex((value) => value === "asset" || value === "symbol" || value === "tai_san");
  const typeIndex = header.findIndex((value) => value === "asset_type" || value === "type" || value === "loai");
  const quantityIndex = header.findIndex((value) => value === "quantity" || value === "qty" || value === "ql" || value === "sl");
  const totalValueIndex = header.findIndex((value) => value === "total_value" || value === "total" || value === "tong_gia_tri");
  const unitPriceIndex = header.findIndex((value) => value === "unit_price" || value === "price" || value === "gia");
  const realizedInterestIndex = header.findIndex((value) => value === "realized_interest" || value === "interest");
  const fundingSourceIndex = header.findIndex((value) => value === "funding_source" || value === "source" || value === "nguon_tien");
  const executedAtIndex = header.findIndex((value) => value === "executed_at" || value === "date" || value === "ngay");
  const createdAtIndex = header.findIndex((value) => value === "created_at");
  const updatedAtIndex = header.findIndex((value) => value === "updated_at");
  const noteIndex = header.findIndex((value) => value === "note" || value === "ghi_chu");

  const missing: string[] = [];
  if (sideIndex === -1) missing.push("side");
  if (assetIndex === -1) missing.push("asset");
  if (typeIndex === -1) missing.push("asset_type");
  if (quantityIndex === -1) missing.push("quantity");
  if (totalValueIndex === -1) missing.push("total_value");
  if (executedAtIndex === -1) missing.push("executed_at");
  if (missing.length) {
    throw new Error(`Transactions sheet is missing required columns: ${missing.join(", ")}`);
  }

  const parsedRows: TransactionImportRow[] = [];

  rows.slice(headerIndex + 1).forEach((row, index) => {
    const rowNumber = headerIndex + index + 2;
    const sideText = String(row[sideIndex] ?? "").trim().toLowerCase();
    if (!sideText) return;
    const side = sideText === "buy" || sideText === "mua"
      ? "buy"
      : sideText === "sell" || sideText === "ban" || sideText === "bán"
        ? "sell"
        : null;
    if (!side) {
      throw new Error(`Transactions row ${rowNumber}: side must be buy or sell`);
    }

    const symbol = String(row[assetIndex] ?? "").trim().toUpperCase();
    if (!symbol) {
      throw new Error(`Transactions row ${rowNumber}: asset is required`);
    }

    const cell = (i: number) => row[i] as string | number | boolean | Date | null;
    const num = (i: number) => row[i] as string | number | boolean | null;
    const assetType = normalizeInvestmentType(num(typeIndex));
    const quantity = parseVNNumber(num(quantityIndex));
    const totalValue = parseVNNumber(num(totalValueIndex));
    if (quantity == null || quantity <= 0) {
      throw new Error(`Transactions row ${rowNumber}: quantity must be greater than 0`);
    }
    if (totalValue == null || totalValue <= 0) {
      throw new Error(`Transactions row ${rowNumber}: total_value must be greater than 0`);
    }

    const executedAt = parseDateCell(cell(executedAtIndex));
    if (!executedAt) {
      throw new Error(`Transactions row ${rowNumber}: executed_at is invalid`);
    }

    const unitPrice = unitPriceIndex >= 0
      ? (parseVNNumber(num(unitPriceIndex)) ?? totalValue / quantity)
      : totalValue / quantity;
    const realizedInterest = realizedInterestIndex >= 0
      ? (parseVNNumber(num(realizedInterestIndex)) ?? 0)
      : 0;
    const createdAt = createdAtIndex >= 0 ? (parseDateCell(cell(createdAtIndex)) ?? new Date()) : new Date();
    const updatedAt = updatedAtIndex >= 0 ? (parseDateCell(cell(updatedAtIndex)) ?? createdAt) : createdAt;
    const note = noteIndex >= 0 ? String(cell(noteIndex) ?? "").trim() || null : null;
    const fundingSource = fundingSourceIndex >= 0
      ? String(cell(fundingSourceIndex) ?? "CASH").trim().toUpperCase() || "CASH"
      : "CASH";

    parsedRows.push({
      side,
      fundingSource,
      assetType,
      symbol,
      quantity,
      totalValue,
      unitPrice,
      realizedInterest,
      note,
      executedAt,
      createdAt,
      updatedAt,
    });
  });

  return parsedRows;
}

function parseTransactionRows(workbook: XLSX.WorkBook, sheetName: string): TransactionImportRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  return parseTransactionRowsFromRaw(rows as unknown[][]);
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

router.get("/excel/sheets", async (_req, res) => {
  try {
    const config = getGoogleDriveConfig();
    if (config && await isNativeGoogleSheet()) {
      const names = await getGoogleSheetNames();
      res.json({ sheets: names, source: getExcelSourceInfo() });
      return;
    }
    const workbook = await loadWorkbook();
    res.json({ sheets: workbook.SheetNames, source: getExcelSourceInfo() });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/excel/sheet", async (req, res) => {
  const name = String(req.query.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing sheet name" });
    return;
  }

  try {
    const config = getGoogleDriveConfig();
    if (config && await isNativeGoogleSheet()) {
      const rows = await getGoogleSheetsValues(name);
      res.json({ name, rows, source: getExcelSourceInfo() });
      return;
    }
    // Local file fallback
    const workbook = await loadWorkbook();
    const resolvedName = resolveWorkbookSheetName(workbook, name);
    if (!resolvedName) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    const sheet = workbook.Sheets[resolvedName];
    const rows = sheetToValueGrid(sheet);
    res.json({ name: resolvedName, rows, source: getExcelSourceInfo() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/excel/investment/update-price", async (req, res): Promise<void> => {
  const symbol = String(req.body?.symbol ?? "").trim().toUpperCase();
  const price  = Number(req.body?.price);
  if (!symbol || !Number.isFinite(price) || price < 0) {
    res.status(400).json({ error: "symbol và price là bắt buộc" });
    return;
  }

  try {
    // 1. Update DB
    const [updated] = await db
      .update(holdingsTable)
      .set({ manualPrice: String(price), updatedAt: new Date() })
      .where(eq(holdingsTable.symbol, symbol))
      .returning();

    if (!updated) {
      res.status(404).json({ error: `Không tìm thấy holding "${symbol}"` });
      return;
    }

    // 2. Write back to Google Sheets (always try when config present)
    if (getGoogleDriveConfig()) {
      const SHEET = "Investment";
      const rows = await getGoogleSheetsValues(SHEET);
      const headerIndex = rows.findIndex(row =>
        ["tai_san", "asset", "symbol"].includes(normalizeHeaderName(row[0] as string))
      );
      if (headerIndex >= 0) {
        const header = rows[headerIndex].map(c => normalizeHeaderName(c as string));
        const symCol   = header.findIndex(h => ["tai_san","asset","symbol"].includes(h));
        const priceCol = header.findIndex(h => ["current_price","price"].includes(h));
        if (symCol >= 0 && priceCol >= 0) {
          const dataRow = rows.findIndex((row, i) =>
            i > headerIndex && String(row[symCol] ?? "").trim().toUpperCase() === symbol
          );
          if (dataRow >= 0) await writeGoogleSheetsCell(SHEET, dataRow, priceCol, price);
        }
      }
    }

    res.json({ success: true, symbol, price });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/excel/investment/sync", async (req, res): Promise<void> => {
  try {
    const requestedSheetName = String(req.body?.name ?? "").trim();

    let rows: InvestmentRow[];
    let transactionRows: TransactionImportRow[];

    if (await isNativeGoogleSheet()) {
      const investmentSheetName = requestedSheetName || "Investment";
      const [investRaw, txRaw, sheetNames] = await Promise.all([
        getGoogleSheetsValues(investmentSheetName),
        getGoogleSheetsValues("Transactions").catch(() => [] as unknown[][]),
        getGoogleSheetNames(),
      ]);
      if (!sheetNames.includes(investmentSheetName)) {
        res.status(404).json({ error: `Sheet "${investmentSheetName}" không tồn tại.` });
        return;
      }
      rows = parseInvestmentRowsFromRaw(investRaw);
      transactionRows = parseTransactionRowsFromRaw(txRaw);
    } else {
      const workbook = await loadWorkbook();
      const investmentSheetName = requestedSheetName
        ? (resolveWorkbookSheetName(workbook, requestedSheetName) ?? requestedSheetName)
        : resolveInvestmentSheetName(workbook);
      const transactionsSheetName = workbook.SheetNames.find((name) => isTransactionsSheetName(name)) ?? null;
      if (!workbook.Sheets[investmentSheetName]) {
        res.status(404).json({ error: `Sheet "${investmentSheetName}" không tồn tại.` });
        return;
      }
      rows = parseInvestmentRows(workbook, investmentSheetName);
      transactionRows = transactionsSheetName ? parseTransactionRows(workbook, transactionsSheetName) : [];
    }

    if (rows.length === 0) {
      res.status(400).json({ error: `Sheet Investment không có dòng dữ liệu hợp lệ để sync.` });
      return;
    }

    const syncResult = await db.transaction(async (tx) => {
      const [existingHoldings, deletedTransactions] = await Promise.all([
        tx.select().from(holdingsTable),
        tx.delete(transactionsTable).returning({ id: transactionsTable.id }),
      ]);
      const clearedTransactions = deletedTransactions.length;
      const existingBySymbol = new Map(existingHoldings.map((holding) => [holding.symbol.toUpperCase(), holding]));
      const syncedSymbols = new Set(rows.map((row) => row.symbol));

      let created = 0;
      let updated = 0;
      let removed = 0;
      const skipped: string[] = [];

      for (const row of rows) {
        const existing = existingBySymbol.get(row.symbol);

        if (existing) {
          await tx
            .update(holdingsTable)
            .set({
              type: row.type,
              quantity: String(row.quantity),
              manualPrice: shouldSyncManualPrice(row.type)
                ? row.manualPrice != null
                  ? String(row.manualPrice)
                  : null
                : null,
              costOfCapital: row.costOfCapital != null ? String(row.costOfCapital) : null,
              interest: row.interest != null ? String(row.interest) : null,
              updatedAt: new Date(),
            })
            .where(eq(holdingsTable.id, existing.id));
          updated += 1;
          continue;
        }

        await tx.insert(holdingsTable).values({
          symbol: row.symbol,
          type: row.type,
          quantity: String(row.quantity),
          manualPrice: shouldSyncManualPrice(row.type)
            ? row.manualPrice != null
              ? String(row.manualPrice)
              : null
            : null,
          costOfCapital: row.costOfCapital != null ? String(row.costOfCapital) : null,
          interest: row.interest != null ? String(row.interest) : null,
        });
        created += 1;
      }

      for (const holding of existingHoldings) {
        if (syncedSymbols.has(holding.symbol.toUpperCase())) continue;
        await tx.delete(holdingsTable).where(eq(holdingsTable.id, holding.id));
        removed += 1;
      }

      if (transactionRows.length > 0) {
        await tx.insert(transactionsTable).values(
          transactionRows.map((transaction) => ({
            side: transaction.side,
            origin: "excel_sync",
            fundingSource: transaction.fundingSource,
            assetType: transaction.assetType,
            symbol: transaction.symbol,
            quantity: String(transaction.quantity),
            totalValue: String(transaction.totalValue),
            unitPrice: String(transaction.unitPrice),
            realizedInterest: String(transaction.realizedInterest),
            note: transaction.note,
            status: "applied",
            executedAt: transaction.executedAt,
            createdAt: transaction.createdAt,
            updatedAt: transaction.updatedAt,
          }))
        );
      }

      return {
        clearedTransactions,
        created,
        updated,
        removed,
        skipped,
      };
    });

    res.json({
      success: true,
      total: rows.length,
      created: syncResult.created,
      updated: syncResult.updated,
      removed: syncResult.removed,
      skipped: syncResult.skipped,
      clearedTransactions: syncResult.clearedTransactions,
      importedTransactions: transactionRows.length,
      warning: syncResult.clearedTransactions > 0
        ? `Sync overwrote holdings, cleared ${syncResult.clearedTransactions} trade order(s), imported ${transactionRows.length} transaction row(s).`
        : null,
      message: `Đã sync ${rows.length} dòng từ sheet Investment sang Tài sản.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể sync sheet Investment.";
    res.status(500).json({ error: message });
  }
});

export default router;
