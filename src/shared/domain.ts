import { z } from "zod";

// Valores de domínio compartilhados por banco, API, frontend e MCP.

export const gameStatuses = [
  "playing",
  "finished",
  "backlog",
  "wishlist",
  "paused",
  "dropped",
] as const;
export const gameStatusSchema = z.enum(gameStatuses);
export type GameStatus = z.infer<typeof gameStatusSchema>;

export const gameStatusLabels: Record<GameStatus, string> = {
  playing: "Jogando",
  finished: "Zerado",
  backlog: "Próximos",
  wishlist: "Desejos",
  paused: "Pausado",
  dropped: "Abandonado",
};

export const sessionSources = ["manual", "mcp", "discord", "steam"] as const;
export const sessionSourceSchema = z.enum(sessionSources);
export type SessionSource = z.infer<typeof sessionSourceSchema>;

export const activityActors = ["web", "mcp", "job"] as const;
export const activityActorSchema = z.enum(activityActors);
export type ActivityActor = z.infer<typeof activityActorSchema>;

export const ttbSources = ["igdb", "hltb"] as const;
export type TtbSource = (typeof ttbSources)[number];
