import type { IgdbGamePage } from "../../shared/game-page";
import type { Db } from "../db/client";
import { IgdbNotConfiguredError, NotFoundError } from "../errors";
import type { Clock } from "./context";
import type { IgdbApi } from "./igdb";
import { type Cached, createKvCache, writeCached } from "./kv-cache";

// Dados do IGDB da página de cada jogo, guardados no `kv` por 1 dia (iguais para todos os
// usuários). A tabela `games` continua sendo só o cache dos jogos da biblioteca.

/** Sobe quando o formato de `IgdbGamePage` mudar: o cache antigo é ignorado. */
const CACHE_VERSION = 1;

export interface GamePagesService {
  /** NotFoundError se o jogo não existir no IGDB; IgdbError se o IGDB falhar sem cache. */
  get(igdbId: number): Promise<Cached<IgdbGamePage>>;
  /** Espera as atualizações em segundo plano terminarem (testes e scripts). */
  settled(): Promise<void>;
}

export interface GamePagesServiceOptions {
  db: Db;
  igdb: IgdbApi;
  clock: Pick<Clock, "now">;
  ttlMs?: number;
  onError?: (error: unknown, igdbId: number) => void;
}

export function createGamePagesService({
  db,
  igdb,
  clock,
  ttlMs,
  onError = (error, igdbId) => console.error(`Falha ao buscar o jogo ${igdbId} no IGDB:`, error),
}: GamePagesServiceOptions): GamePagesService {
  const cache = createKvCache<number, IgdbGamePage>({
    db,
    clock,
    ttlMs,
    kvKey: gamePageKvKey,
    async load(igdbId) {
      const page = await igdb.getGamePage(igdbId);
      if (!page) throw new NotFoundError(`Jogo ${igdbId} não encontrado no IGDB`);
      return page;
    },
    isValid: isGamePage,
    onError: (error, igdbId) => {
      // Jogo inexistente e IGDB sem credenciais não são falhas do servidor.
      if (error instanceof NotFoundError || error instanceof IgdbNotConfiguredError) return;
      onError(error, igdbId);
    },
  });

  return { get: (igdbId) => cache.get(igdbId), settled: () => cache.settled() };
}

function gamePageKvKey(igdbId: number): string {
  return `igdb:game:v${CACHE_VERSION}:${igdbId}`;
}

function isGamePage(value: unknown): value is IgdbGamePage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Partial<IgdbGamePage>;
  return typeof page.igdbId === "number" && typeof page.related === "object";
}

/** Grava uma página direto no cache (seed do demo, que roda sem credenciais do IGDB). */
export function saveGamePage(db: Db, page: IgdbGamePage, updatedAt: Date): void {
  writeCached(db, gamePageKvKey(page.igdbId), page, updatedAt);
}
