// Escala do heatmap: degraus com significado, não quartis. O primeiro corte é o mínimo da
// ofensiva, então o degrau 1 é "jogou, mas não contou para a ofensiva".

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Limites inferiores dos degraus 2, 3 e 4, em minutos. */
export function heatThresholds(streakMinMinutes: number): [number, number, number] {
  return [
    streakMinMinutes,
    Math.max(120, 2 * streakMinMinutes),
    Math.max(240, 4 * streakMinMinutes),
  ];
}

export function heatLevel(minutes: number, streakMinMinutes: number): HeatLevel {
  if (minutes <= 0) return 0;
  const [counts, more, most] = heatThresholds(streakMinMinutes);
  if (minutes >= most) return 4;
  if (minutes >= more) return 3;
  if (minutes >= counts) return 2;
  return 1;
}

/** Uma cor só (--chart-2) misturada com o fundo do card: do fraco ao forte nos dois temas. */
export const heatColors: Record<HeatLevel, string> = {
  0: "var(--muted)",
  1: "color-mix(in oklab, var(--chart-2) 35%, var(--card))",
  2: "color-mix(in oklab, var(--chart-2) 60%, var(--card))",
  3: "color-mix(in oklab, var(--chart-2) 80%, var(--card))",
  4: "var(--chart-2)",
};
