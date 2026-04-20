import type { TypeMode } from "@/pages/assets/types";

const VND_INT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const VND_2 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

export function formatVND(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `${VND_2.format(value / 1_000_000_000)} tỷ`;
  if (value >= 1_000_000) return `${VND_2.format(value / 1_000_000)} tr`;
  return `${VND_INT.format(value)} ₫`;
}

export function formatVNDFull(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${VND_INT.format(value)} ₫`;
}

export function resolveMode(type: string): TypeMode {
  if (type === "stock") return "stock";
  if (type === "gold") return "gold";
  return "other";
}

export function typeLabel(type: string) {
  if (type === "stock") return "📈 Cổ phiếu";
  if (type === "gold") return "🥇 Vàng";
  const name = type.charAt(0).toUpperCase() + type.slice(1);
  return `💼 ${name}`;
}

export function formatTypeLabel(type: string) {
  if (type === "stock") return "📈 Cổ phiếu";
  if (type === "gold") return "🥇 Vàng";
  if (type === "crypto") return "🪙 Crypto";
  return `💼 ${type.charAt(0).toUpperCase() + type.slice(1)}`;
}
