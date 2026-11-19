// Formatação para exibição (pt-BR).

import { isoDateSchema } from "@shared/dates";

/** 0 → "0min", 45 → "45min", 210 → "3h 30min", 120 → "2h". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

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
