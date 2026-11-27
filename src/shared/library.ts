import { z } from "zod";
import type { CompletionSummary, DisplayState } from "./completions";
import type { AchievementsSummary } from "./achievements";
import type { ObjectivesSummary } from "./objectives";
import { isoDateSchema } from "./dates";
import { MAX_PRICE_CENTS } from "./money";
import {
  type CompletionType,
  type GameStatus,
  gameStatusSchema,
  type PlaytimeSource,
  playtimeSourceSchema,
} from "./domain";
import type { TimeToBeat } from "./igdb";

// Contrato da biblioteca, compartilhado por API, frontend e MCP.

export interface LibraryItem {
  gameId: number;
  igdbId: number;
  name: string;
  slug: string | null;
  coverImageId: string | null;
  platforms: string[];
  genres: string[];
  themes: string[];
  gameModes: string[];
  perspectives: string[];
  releaseYear: number | null;
  timeToBeat: TimeToBeat | null;
  status: GameStatus;
  /** O status, ou "postgame" quando está jogando um jogo já zerado. */
  displayState: DisplayState;
  /** Conclusões (null se nunca zerou). */
  completion: CompletionSummary | null;
  /** Objetivos feitos/total (null se o jogo não tem objetivos). */
  objectives: ObjectivesSummary | null;
  /** Conquistas das listas que o jogo segue (null se não segue nenhuma). */
  achievements: AchievementsSummary | null;
  /** De qual console é a versão jogada (ex.: Switch, mesmo emulado no PC). */
  platformPlayed: string | null;
  /** Onde rodou, quando emulado (PC, Android, Steam Deck…); null = nativo. */
  emulatedOn: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  notes: string | null;
  /** Compra (comprei × zerei); null se nada foi informado. */
  purchase: Purchase | null;
  addedAt: string;
  updatedAt: string;
  /**
   * Total jogado, o que vale para o progresso: sessões + `priorMinutes`, ou o total da Steam
   * quando `playtimeSource` é "steam" (e já sincronizou).
   */
  minutesPlayed: number;
  /** Só o das sessões registradas no Zerômetro. */
  sessionMinutes: number;
  /** Tempo jogado antes de registrar no Zerômetro (sem data, fora das estatísticas). */
  priorMinutes: number;
  /** De onde vem `minutesPlayed`: sessões (controle manual) ou Steam. */
  playtimeSource: PlaytimeSource;
  /** Tempo na Steam na última sincronização (null se nunca sincronizou ou não está na conta). */
  steamPlaytime: { minutes: number; syncedAt: string } | null;
  /**
   * O jogo está na Steam: o IGDB tem o app (`external_games`), o jogo segue uma lista da Steam ou
   * já tem tempo de lá. null: o IGDB ainda não foi consultado (a próxima sincronização confere).
   */
  onSteam: boolean | null;
  sessionsCount: number;
  lastPlayedOn: string | null;
  /** "Onde parei": a nota da última sessão encerrada que tem nota (null se nenhuma tem). */
  lastNote: LastSessionNote | null;
  /** Data da primeira sessão registrada (o "comecei a jogar" usa quando `startedAt` está vazio). */
  firstPlayedOn: string | null;
  /** 0..1, estimado pelo tempo do IGDB rumo a `progressTarget`. null sem tempo e sem conclusão. */
  progress: number | null;
  /** Para onde o progresso aponta: história antes de zerar, depois extras e 100%. */
  progressTarget: CompletionType;
}

export interface Purchase {
  /** Dia em que comprou ou resgatou (YYYY-MM-DD). */
  acquiredOn: string | null;
  /** Em centavos de real (0 = de graça). */
  pricePaidCents: number | null;
  /** Loja ou serviço, texto livre (Steam, Nuuvem, Game Pass…). */
  store: string | null;
  /** Veio de uma assinatura: sem preço, fora do custo por hora. */
  viaSubscription: boolean;
}

export interface LastSessionNote {
  sessionId: number;
  note: string;
  /** Dia da sessão (YYYY-MM-DD). */
  playedOn: string;
}

export type StatusCounts = Record<GameStatus, number>;

// ---------------------------------------------------------------------------
// Ordenação (no cliente: a lista vem inteira e fica salva offline; o MCP usa a mesma regra)

export const librarySorts = ["last_session", "started_at", "rating"] as const;
export type LibrarySort = (typeof librarySorts)[number];
export const librarySortSchema = z.enum(librarySorts);

export const sortDirections = ["desc", "asc"] as const;
export type SortDirection = (typeof sortDirections)[number];
export const sortDirectionSchema = z.enum(sortDirections);

export const librarySortLabels: Record<LibrarySort, string> = {
  last_session: "Última sessão",
  started_at: "Comecei a jogar",
  rating: "Minha nota",
};

/** O valor que ordena o jogo no critério (null: não tem, vai para o fim). */
export function sortValueOf(item: LibraryItem, sort: LibrarySort): string | number | null {
  switch (sort) {
    case "last_session":
      return item.lastPlayedOn;
    case "started_at":
      return item.startedAt ?? item.firstPlayedOn;
    case "rating":
      return item.rating;
  }
}

const byName = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/**
 * Ordena pelo critério (desc: mais recente/maior nota primeiro). Quem não tem o valor fica sempre
 * no fim, nas duas direções; empate vai pelo nome.
 */
export function sortLibraryItems<T extends LibraryItem>(
  items: readonly T[],
  sort: LibrarySort,
  direction: SortDirection = "desc",
): T[] {
  const sign = direction === "desc" ? -1 : 1;
  return items
    .map((item) => ({ item, value: sortValueOf(item, sort) }))
    .toSorted((a, b) => {
      if (a.value !== b.value) {
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return (a.value < b.value ? -1 : 1) * sign;
      }
      return byName.compare(a.item.name, b.item.name);
    })
    .map(({ item }) => item);
}

export interface UpdateLibraryEntryResult {
  item: LibraryItem;
  /** Status antes da mudança (ex.: para saber se o jogo acabou de ser zerado). */
  previousStatus: GameStatus;
}

export interface RemovalSummary {
  gameId: number;
  name: string;
  sessionsCount: number;
  minutesPlayed: number;
  completionsCount: number;
  objectivesCount: number;
  /** Conquistas desbloqueadas nas listas do jogo (somem junto, se nenhum outro jogo seguir a lista). */
  achievementsUnlocked: number;
}

export const gameIdParamSchema = z.object({ gameId: z.coerce.number().int().positive() });

export const libraryListQuerySchema = z.object({
  status: gameStatusSchema.optional(),
  /** Só os jogos em pós-jogo (jogando e já zerados). */
  displayState: z.literal("postgame").optional(),
  q: z.string().trim().max(100).optional(),
});
export type LibraryListQuery = z.infer<typeof libraryListQuerySchema>;

const platformSchema = z.string().trim().min(1).max(50);

/** Onde costuma rodar a emulação (o campo aceita qualquer texto em "Outro"). */
export const emulationTargets = ["PC", "Android", "Steam Deck"] as const;

/**
 * Onde o jogo foi jogado, para mostrar: "Switch", "Switch (emulado no PC)" ou "Emulado no PC"
 * (sem console informado). null sem nenhum dos dois.
 */
export function platformLabel({
  platformPlayed,
  emulatedOn,
}: Pick<LibraryItem, "platformPlayed" | "emulatedOn">): string | null {
  if (!emulatedOn) return platformPlayed;
  const where = `emulado ${(emulationTargets as readonly string[]).includes(emulatedOn) ? "no" : "em"} ${emulatedOn}`;
  return platformPlayed ? `${platformPlayed} (${where})` : where[0]!.toUpperCase() + where.slice(1);
}

/** Onde o jogo roda de fato: o aparelho da emulação ou a plataforma (para "onde vou jogar"). */
export const deviceOf = (item: Pick<LibraryItem, "platformPlayed" | "emulatedOn">) =>
  item.emulatedOn ?? item.platformPlayed;

/** Até 9999h de tempo anterior por jogo. */
export const MAX_PRIOR_MINUTES = 9999 * 60;
export const priorMinutesSchema = z
  .number()
  .int()
  .min(0, "O tempo anterior não pode ser negativo")
  .max(MAX_PRIOR_MINUTES, "O tempo anterior vai até 9999h");

export const addToLibrarySchema = z.object({
  igdbId: z.number().int().positive(),
  status: gameStatusSchema,
  platformPlayed: platformSchema.nullish(),
  emulatedOn: platformSchema.nullish(),
  priorMinutes: priorMinutesSchema.optional(),
});
export type AddToLibraryInput = z.infer<typeof addToLibrarySchema>;

export const pricePaidCentsSchema = z
  .number()
  .int()
  .min(0, "O preço não pode ser negativo")
  .max(MAX_PRICE_CENTS, "O preço vai até R$ 99.999,99");

export const storeSchema = z.string().trim().min(1).max(50);

/** Sugestões do campo de loja (o campo aceita qualquer texto). */
export const storeSuggestions = [
  "Steam",
  "Epic Games Store",
  "GOG",
  "Nuuvem",
  "Green Man Gaming",
  "Humble",
  "eShop",
  "PlayStation Store",
  "Microsoft Store",
  "Mídia física",
] as const;
export const subscriptionSuggestions = [
  "Game Pass",
  "PS Plus",
  "Nintendo Switch Online",
  "Ubisoft+",
  "EA Play",
  "Prime Gaming",
] as const;

export const updateLibraryEntrySchema = z
  .object({
    status: gameStatusSchema,
    rating: z.number().int().min(1).max(10).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    platformPlayed: platformSchema.nullable(),
    emulatedOn: platformSchema.nullable(),
    startedAt: isoDateSchema.nullable(),
    finishedAt: isoDateSchema.nullable(),
    priorMinutes: priorMinutesSchema,
    playtimeSource: playtimeSourceSchema,
    acquiredOn: isoDateSchema.nullable(),
    pricePaidCents: pricePaidCentsSchema.nullable(),
    store: storeSchema.nullable(),
    viaSubscription: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para atualizar");
export type UpdateLibraryEntryInput = z.infer<typeof updateLibraryEntrySchema>;
