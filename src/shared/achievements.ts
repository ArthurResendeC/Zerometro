import { z } from "zod";

// Contrato das conquistas (Steam e RetroAchievements), compartilhado por API, frontend e MCP.

export const achievementSources = ["steam", "retroachievements"] as const;
export const achievementSourceSchema = z.enum(achievementSources);
export type AchievementSource = z.infer<typeof achievementSourceSchema>;

export const achievementSourceLabels: Record<AchievementSource, string> = {
  steam: "Steam",
  retroachievements: "RetroAchievements",
};

/**
 * O id do jogo na fonte a partir do que o usuário colar: o número ou a URL
 * (`store.steampowered.com/app/504230/...`, `retroachievements.org/game/1446`).
 */
export function parseSourceGameId(source: AchievementSource, input: string): number | null {
  const trimmed = input.trim();
  const pattern =
    source === "steam"
      ? /(?:steampowered|steamcommunity)\.com\/(?:app|stats)\/(\d+)/i
      : /retroachievements\.org\/game\/(\d+)/i;
  const digits = /^\d+$/.test(trimmed) ? trimmed : pattern.exec(trimmed)?.[1];
  const id = Number(digits);
  return digits && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Página do jogo na fonte (crédito "Conquistas: Steam" / "Conquistas: RetroAchievements"). */
export function achievementSourceUrl(source: AchievementSource, externalId: string): string {
  return source === "steam"
    ? `https://store.steampowered.com/app/${externalId}/`
    : `https://retroachievements.org/game/${externalId}`;
}

/** Desbloqueio marcado à mão (fase 1) ou vindo do perfil na fonte (fase 2). */
export const achievementUnlockOrigins = ["manual", "sync"] as const;
export type AchievementUnlockOrigin = (typeof achievementUnlockOrigins)[number];
