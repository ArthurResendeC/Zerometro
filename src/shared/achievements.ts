import { z } from "zod";
import { isoDateSchema } from "./dates";

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

export interface AchievementItem {
  id: number;
  title: string;
  description: string | null;
  iconUrl: string | null;
  iconLockedUrl: string | null;
  /** % global de quem desbloqueou. */
  rarity: number | null;
  /** Pontos (só RA). */
  points: number | null;
  /** Secreta: a interface esconde até pedir para ver (se ainda não foi desbloqueada). */
  hidden: boolean;
  /** Sumiu da fonte: só aparece se já tinha sido desbloqueada, e fica fora das contas. */
  removed: boolean;
  /** Quando desbloqueou (ISO UTC); null se ainda não. */
  unlockedAt: string | null;
  origin: AchievementUnlockOrigin | null;
}

export interface AchievementsSummary {
  total: number;
  unlocked: number;
  /** Pontos (RA) da lista e já conquistados; 0 na Steam. */
  points: number;
  pointsUnlocked: number;
}

/** Uma lista que o jogo segue, com o progresso do usuário. */
export interface AchievementSetItem extends AchievementsSummary {
  id: number;
  source: AchievementSource;
  externalId: string;
  /** Nome do jogo na fonte (null se a fonte não deu um confiável). */
  title: string | null;
  /** Console no RA. */
  platform: string | null;
  /** Página do jogo na fonte (crédito). */
  url: string;
  /** Quando a lista foi buscada na fonte (ISO UTC). */
  fetchedAt: string;
  achievements: AchievementItem[];
}

export interface GameAchievements {
  gameId: number;
  /** Fontes ligadas nesta instância (sem chave, a fonte some da interface). */
  sources: Record<AchievementSource, boolean>;
  sets: AchievementSetItem[];
  /** Somando todas as listas; null se o jogo não segue nenhuma. */
  summary: AchievementsSummary | null;
}

/** Uma lista que dá para ligar ao jogo. */
export interface AchievementSetCandidate {
  source: AchievementSource;
  externalId: string;
  title: string | null;
  platform: string | null;
  iconUrl: string | null;
  /** Quantas conquistas (null se a fonte não disse sem buscar a lista). */
  achievementsCount: number | null;
  points: number | null;
  /** De onde veio: o appid do IGDB (Steam) ou a busca pelo nome (RA). */
  via: "igdb" | "name";
  /** Lista extra do RA ("[Subset - Bonus]"). */
  subset: boolean;
  /** O jogo já segue esta lista. */
  linked: boolean;
}

export interface AchievementCandidates {
  sources: Record<AchievementSource, boolean>;
  candidates: AchievementSetCandidate[];
  /** Consoles do RA onde a busca procurou (das plataformas do jogo, ou o escolhido). */
  consoles: { id: number; name: string }[];
  /** Fontes que falharam (as outras sugestões continuam valendo). */
  errors: { source: AchievementSource; message: string }[];
}

export const achievementCandidatesQuerySchema = z.object({
  /** Outro nome para buscar no RA (padrão: o nome do jogo). */
  q: z.string().trim().min(2).max(100).optional(),
  /** Buscar neste console do RA em vez dos das plataformas do jogo. */
  consoleId: z.coerce.number().int().positive().optional(),
});
export type AchievementCandidatesQuery = z.infer<typeof achievementCandidatesQuerySchema>;

export const linkAchievementSetSchema = z.object({
  source: achievementSourceSchema,
  /** O id do jogo na fonte ou a URL dele (loja da Steam, página do RA). */
  id: z.string().trim().min(1, "Informe o id ou a URL").max(300),
});
export type LinkAchievementSetInput = z.infer<typeof linkAchievementSetSchema>;

export const achievementSetParamSchema = z.object({
  gameId: z.coerce.number().int().positive(),
  setId: z.coerce.number().int().positive(),
});

/** Resposta das escritas: o que mudou, o resumo do jogo e o que a interface deve comemorar. */
export interface AchievementWriteResult {
  achievements: AchievementItem[];
  summary: AchievementsSummary;
  /** Esta mudança desbloqueou a última conquista do jogo. */
  allDoneNow: boolean;
  /** Acabou de completar todas e o jogo ainda não tem conclusão 100%: perguntar se quer marcar. */
  suggestFullCompletion: boolean;
}

export const achievementParamSchema = z.object({
  gameId: z.coerce.number().int().positive(),
  achievementId: z.coerce.number().int().positive(),
});

export const setAchievementSchema = z.object({
  unlocked: z.boolean(),
  /** Dia em que desbloqueou (padrão: agora). Só vale ao desbloquear. */
  unlockedOn: isoDateSchema.optional(),
});
export type SetAchievementInput = z.infer<typeof setAchievementSchema>;

export const MAX_ACHIEVEMENTS_PER_WRITE = 1000;

export const setManyAchievementsSchema = setAchievementSchema.extend({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_ACHIEVEMENTS_PER_WRITE),
});
export type SetManyAchievementsInput = z.infer<typeof setManyAchievementsSchema>;

export const achievementsDone = (s: AchievementsSummary | null) =>
  s !== null && s.total > 0 && s.unlocked === s.total;
