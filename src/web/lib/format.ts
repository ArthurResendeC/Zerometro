// Formatação para exibição (pt-BR).

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

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-11-19" → "19 de nov. de 2026". Datas de calendário são tratadas como UTC para não mudar o dia. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
