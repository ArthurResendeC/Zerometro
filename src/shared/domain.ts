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

export const sessionSources = ["manual", "timer", "mcp", "steam"] as const;
export const sessionSourceSchema = z.enum(sessionSources);
export type SessionSource = z.infer<typeof sessionSourceSchema>;

export const activityActors = ["web", "mcp", "job"] as const;
export const activityActorSchema = z.enum(activityActors);
export type ActivityActor = z.infer<typeof activityActorSchema>;

export const ttbSources = ["igdb", "hltb"] as const;
export type TtbSource = (typeof ttbSources)[number];

/** Até onde cheguei num jogo, do menor para o maior: história, história + extras, 100%. */
export const completionTypes = ["main", "extras", "full"] as const;
export const completionTypeSchema = z.enum(completionTypes);
export type CompletionType = z.infer<typeof completionTypeSchema>;

export const completionTypeLabels: Record<CompletionType, string> = {
  main: "História",
  extras: "História + extras",
  full: "100%",
};

/**
 * De onde vem o tempo jogado de um jogo: das sessões (+ o tempo antes do Zerômetro) ou do total
 * da Steam, sincronizado. As sessões continuam valendo para ofensiva e estatísticas por dia.
 */
export const playtimeSources = ["sessions", "steam"] as const;
export const playtimeSourceSchema = z.enum(playtimeSources);
export type PlaytimeSource = z.infer<typeof playtimeSourceSchema>;

/** Objetivos manuais hoje; conquistas da Steam/RetroAchievements no futuro. */
export const objectiveSources = ["manual", "steam", "retroachievements"] as const;
export const objectiveSourceSchema = z.enum(objectiveSources);
export type ObjectiveSource = z.infer<typeof objectiveSourceSchema>;
