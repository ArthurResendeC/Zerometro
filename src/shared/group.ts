import { z } from "zod";
import type { Avatar } from "./auth";
import type { AchievementsSummary } from "./achievements";
import type { CompletionType, GameStatus } from "./domain";
import type { ProfileRow } from "./profile";

// O grupo: todo mundo da instância que deixou "Aparecer no grupo" ligado. Nunca sai daqui o
// preço pago, as notas das sessões nem o "onde parei".

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

/** O perfil público de alguém do grupo. */
export interface GroupMemberProfile {
  member: GroupMember;
  playingNow: GroupGameRef | null;
  totals: {
    minutes: number;
    finished: number;
    fullCompletions: number;
    achievements: number;
    streak: number;
    games: number;
  };
  /** Em andamento, os jogados mais recentemente primeiro. */
  playing: GroupMemberGame[];
  /** As últimas conclusões. */
  recentlyFinished: (GroupMemberGame & { completedOn: string; type: CompletionType })[];
  genres: ProfileRow[];
  series: ProfileRow[];
  developers: ProfileRow[];
}

/** Quem do grupo tem um jogo, e como está com ele (página do jogo). */
export interface GroupGameEntry {
  member: GroupMember;
  status: GameStatus;
  minutesPlayed: number;
  completion: { best: CompletionType; lastCompletedOn: string } | null;
  rating: number | null;
  achievements: AchievementsSummary | null;
}
