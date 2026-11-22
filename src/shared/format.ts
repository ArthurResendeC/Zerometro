// Formatação compartilhada entre o site e o servidor (ex.: a imagem do recap).

/** 0 → "0min", 45 → "45min", 210 → "3h 30min", 120 → "2h". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
