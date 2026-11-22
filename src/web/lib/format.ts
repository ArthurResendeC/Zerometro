// Formatação para exibição (pt-BR).

import { isoDateSchema } from "@shared/dates";
import type { ReleasePrecision } from "@shared/feeds";

export { formatMinutes } from "@shared/format";

const hoursFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** Segundos → "87,5h". */
export function formatHoursFromSeconds(seconds: number): string {
  return `${hoursFormat.format(seconds / 3600)}h`;
}

/** "2026-11-19" → "19/11/2026": toda data exibida ao usuário passa por aqui. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

const DISPLAY_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** "19/11/2026" → "2026-11-19"; null se o texto não for uma data completa e existente. */
export function parseDisplayDate(text: string): string | null {
  const match = DISPLAY_DATE.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  return isoDateSchema.safeParse(iso).success ? iso : null;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const monthYear = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Data de lançamento com a precisão que o IGDB conhece:
 * "23/02/2027", "fev. de 2027", "3º tri. 2027" ou só "2027" (o IGDB guarda 31/12 nesse caso).
 */
export function formatReleaseDate(isoDate: string, precision: ReleasePrecision | null): string {
  const [year, month] = isoDate.split("-");
  switch (precision) {
    case "year":
      return year ?? isoDate;
    case "quarter":
      return `${Math.ceil(Number(month) / 3)}º tri. ${year}`;
    case "month":
      return monthYear.format(new Date(`${isoDate}T00:00:00Z`));
    default:
      return formatDate(isoDate);
  }
}

const integerFormat = new Intl.NumberFormat("pt-BR");

/** 2351 → "2.351". */
export function formatCount(value: number): string {
  return integerFormat.format(value);
}

/** Dias de `from` até `to` (datas YYYY-MM-DD); negativo se `to` já passou. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Contagem regressiva para um lançamento: "Sai hoje", "Sai amanhã", "Faltam 96 dias". */
export function formatCountdown(days: number): string {
  if (days <= 0) return "Sai hoje";
  if (days === 1) return "Sai amanhã";
  return `Faltam ${formatCount(days)} dias`;
}
