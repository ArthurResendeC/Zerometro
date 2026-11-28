import { z } from "zod";
import type { Avatar } from "./auth";
import type { AchievementsSummary } from "./achievements";
import type { CompletionType, GameStatus } from "./domain";
import type { GroupSection } from "./group-sections";
import type { GamerProfile, ProfileRow, ProfileSection } from "./profile";
import type { PurchaseStats } from "./purchases";
import type { CriterionAverage } from "./ratings";
import type { Heatmap, PeriodBreakdown, Records, Rhythm } from "./stats";
import type { Timeline } from "./timeline";

// O grupo: todo mundo da instância que deixou "Aparecer no grupo" ligado. Nunca sai daqui as
// notas das sessões nem o "onde parei"; o resto, cada um escolhe (veja group-sections.ts).

export const groupPeriods = ["week", "month", "year", "all"] as const;
export type GroupPeriod = (typeof groupPeriods)[number];
export const groupPeriodLabels: Record<GroupPeriod, string> = {
  week: "Semana",
  month: "Mês",
  year: "Ano",
  all: "Sempre",
};

export const leaderboardQuerySchema = z.object({
  period: z.enum(groupPeriods).default("month"),
});

/** As métricas do ranking (a tela ordena por qualquer uma). */
export const groupMetrics = ["minutes", "finished", "achievements", "streak"] as const;
export type GroupMetric = (typeof groupMetrics)[number];

export interface GroupMember {
  userId: string;
  name: string;
  handle: string;
  avatar: Avatar;
  /** É quem está vendo. */
  isMe: boolean;
}

export interface GroupGameRef {
  igdbId: number;
  name: string;
  coverImageId: string | null;
}

export interface GroupMemberStats extends GroupMember {
  /**
   * Minutos no período, pelas sessões. Em "sempre", o total da biblioteca (com o tempo de antes
   * do Zerômetro e o da Steam, como o perfil de gamer conta).
   */
  minutes: number;
  /** Dias com sessão no período. */
  playedDays: number;
  /** Jogos zerados pela primeira vez no período (replays não contam). */
  finished: number;
  /** Jogos que chegaram aos 100% no período. */
  fullCompletions: number;
  /** Conquistas desbloqueadas no período. */
  achievements: number;
  rarestAchievement: (GroupGameRef & { title: string; rarity: number }) | null;
  /** Ofensiva atual (com o mínimo diário de cada um). */
  streak: number;
  /** O jogo mais jogado no período. */
  topGame: (GroupGameRef & { minutes: number }) | null;
  /** O timer está rodando agora neste jogo. */
  playingNow: GroupGameRef | null;
}

export interface GroupLeaderboard {
  period: GroupPeriod;
  from: string;
  to: string;
  members: GroupMemberStats[];
  /** Quem está vendo desligou "Aparecer no grupo" (vê os outros, mas não entra). */
  meHidden: boolean;
}

export interface GroupMemberGame extends GroupGameRef {
  status: GameStatus;
  minutesPlayed: number;
  completion: { best: CompletionType; lastCompletedOn: string } | null;
  rating: number | null;
}

/** O perfil público de alguém do grupo (a aba Resumo). Seção não compartilhada vem null. */
export interface GroupMemberProfile {
  member: GroupMember;
  playingNow: GroupGameRef | null;
  /** O que a pessoa deixa os amigos verem: decide as abas e as seções da tela. */
  sections: GroupSection[];
  totals: {
    minutes: number;
    finished: number;
    fullCompletions: number;
    achievements: number;
    streak: number;
    games: number;
  } | null;
  /** Em andamento, os jogados mais recentemente primeiro. */
  playing: GroupMemberGame[] | null;
  /** As últimas conclusões. */
  recentlyFinished: (GroupMemberGame & { completedOn: string; type: CompletionType })[] | null;
  /** Os jogos com nota, da maior para a menor. */
  ratings: GroupMemberGame[] | null;
}

/** A aba Estatísticas de alguém do grupo, no mesmo recorte das Estatísticas (ano ou 12 meses). */
export interface GroupMemberStatsView {
  year: number | null;
  /** Anos com alguma sessão, conclusão ou compra (o seletor). */
  years: number[];
  heatmap: Heatmap | null;
  breakdown: PeriodBreakdown | null;
  timeline: Timeline | null;
  rhythm: Rhythm | null;
  records: Records | null;
  purchases: PurchaseStats | null;
}

/** A aba Perfil de gamer de alguém do grupo. Ranking não compartilhado vem null. */
export type GroupMemberGamerProfile = Pick<GamerProfile, "gamesCounted" | "totalMinutes"> & {
  [S in ProfileSection]: ProfileRow[] | null;
} & {
  criteria: CriterionAverage[] | null;
  /** Com as notas escondidas, os rankings vêm sem a média e não dá para ordenar por nota. */
  ratingsShared: boolean;
};

/** Quem do grupo tem um jogo, e como está com ele (página do jogo). */
export interface GroupGameEntry {
  member: GroupMember;
  status: GameStatus;
  minutesPlayed: number;
  completion: { best: CompletionType; lastCompletedOn: string } | null;
  rating: number | null;
  achievements: AchievementsSummary | null;
}
