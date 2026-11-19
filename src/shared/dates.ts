import { z } from "zod";

// Datas de calendário ("YYYY-MM-DD") sempre no fuso do usuário, nunca em UTC.
// O SQLite só enxerga UTC em date('now'), então "hoje" é calculado aqui e passado como parâmetro.

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Data de calendário válida no formato YYYY-MM-DD (rejeita 2026-02-30 etc.). */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE, { error: "Use o formato AAAA-MM-DD", abort: true })
  .refine(isRealDate, "Data inexistente");

/** Ex.: 2026-02-30 vira 2026-03-02 no Date; comparar de volta detecta a data inexistente. */
function isRealDate(value: string): boolean {
  const date = toUtcDate(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Soma (ou subtrai) dias a uma data de calendário. */
export function addDays(isoDate: string, days: number): string {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Diferença em dias entre duas datas de calendário (b - a). */
export function diffInDays(a: string, b: string): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / 86_400_000);
}

/**
 * Interpreta datas digitadas por humanos ou pela IA: "hoje", "ontem", "anteontem" ou YYYY-MM-DD.
 * Retorna null se não reconhecer.
 */
export function parseFriendlyDate(input: string, today: string): string | null {
  const value = input.trim().toLowerCase();
  if (value === "hoje" || value === "today") return today;
  if (value === "ontem" || value === "yesterday") return addDays(today, -1);
  if (value === "anteontem") return addDays(today, -2);
  return isoDateSchema.safeParse(value).success ? value : null;
}

function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** Segunda-feira da semana de uma data de calendário. */
export function startOfWeek(isoDate: string): string {
  const weekday = toUtcDate(isoDate).getUTCDay(); // 0 = domingo
  return addDays(isoDate, -((weekday + 6) % 7));
}
