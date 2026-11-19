import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isoDateSchema } from "../../shared/dates";
import { gameStatusLabels, gameStatusSchema } from "../../shared/domain";
import type { LibraryItem } from "../../shared/library";
import type { AppDeps } from "../app";
import { AppError } from "../errors";
import { createContext, type ServiceContext } from "../services/context";
import { listLibrary, resolveLibraryGame } from "../services/library";
import { listSessions } from "../services/sessions";
import { getSettings } from "../services/settings";
import { getStats } from "../services/stats";
import { getActiveSession } from "../services/timer";

// Servidor MCP do Zerômetro: tools finas por cima dos `services/` (as mesmas regras da API
// REST), sempre no escopo do usuário dono do access token e com actor "mcp".

export type McpDeps = Pick<AppDeps, "db" | "igdb" | "clock">;

const gameRefSchema = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .describe('Id do jogo na biblioteca ou parte do nome (ex.: 12 ou "persona 5")');

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** Resposta de tool em JSON (o cliente mostra ao modelo como texto). */
function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Erros de domínio viram resultado com `isError`, para o modelo ler e corrigir a chamada. */
async function run<T>(fn: () => T | Promise<T>) {
  try {
    return json(await fn());
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { isError: true, content: [{ type: "text" as const, text: error.message }] };
  }
}

/** Resumo de um jogo da biblioteca, sem os campos que só servem à interface. */
function gameSummary(item: LibraryItem) {
  return {
    gameId: item.gameId,
    name: item.name,
    status: item.status,
    statusLabel: gameStatusLabels[item.status],
    platformPlayed: item.platformPlayed,
    releaseYear: item.releaseYear,
    minutesPlayed: item.minutesPlayed,
    progressPercent: item.progress === null ? null : Math.round(item.progress * 100),
    rating: item.rating,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    lastPlayedOn: item.lastPlayedOn,
  };
}

export function createMcpServer(deps: McpDeps, userId: string): McpServer {
  const ctx = (): ServiceContext => createContext(deps.db, deps.clock, "mcp", userId);
  const server = new McpServer({ name: "zerometro", title: "Zerômetro", version: "1.0.0" });

  server.registerTool(
    "search_igdb",
    {
      title: "Buscar jogo no IGDB",
      description:
        'Busca jogos no catálogo do IGDB (não na biblioteca). Use para achar o igdbId certo antes de adicionar um jogo, inclusive a edição (remaster, port). Ex.: query "ocarina of time".',
      inputSchema: z.object({
        query: z.string().trim().min(2).describe("Nome do jogo"),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      annotations: { ...readOnly, openWorldHint: true },
    },
    ({ query, limit }) => run(async () => ({ results: await deps.igdb.searchGames(query, limit) })),
  );

  server.registerTool(
    "list_library",
    {
      title: "Listar biblioteca",
      description:
        "Lista os jogos da biblioteca do usuário, com status, tempo jogado e progresso estimado. Filtre por status (playing = jogando, finished = zerado, backlog = próximos, wishlist = desejos, paused, dropped) e/ou parte do nome.",
      inputSchema: z.object({
        status: gameStatusSchema.optional(),
        query: z.string().trim().max(100).optional().describe("Parte do nome"),
      }),
      annotations: readOnly,
    },
    ({ status, query }) =>
      run(() => ({ games: listLibrary(ctx(), { status, q: query }).map(gameSummary) })),
  );

  server.registerTool(
    "get_game",
    {
      title: "Detalhes de um jogo",
      description:
        "Detalhes de um jogo da biblioteca: status, tempos para zerar (IGDB), total jogado, progresso, nota, anotações e as últimas sessões. Aceita id ou nome; se o nome for ambíguo, devolve as opções.",
      inputSchema: z.object({ game: gameRefSchema }),
      annotations: readOnly,
    },
    ({ game }) =>
      run(() => {
        const scope = ctx();
        const item = resolveLibraryGame(scope, game);
        return {
          ...gameSummary(item),
          genres: item.genres,
          platforms: item.platforms,
          notes: item.notes,
          timeToBeatHours: item.timeToBeat && {
            main: hours(item.timeToBeat.mainSec),
            mainPlusExtras: hours(item.timeToBeat.extraSec),
            completionist: hours(item.timeToBeat.completeSec),
          },
          sessionsCount: item.sessionsCount,
          recentSessions: listSessions(scope, { gameId: item.gameId, limit: 10 }).map(
            ({ id, playedOn, minutes, source, note }) => ({ id, playedOn, minutes, source, note }),
          ),
        };
      }),
  );

  server.registerTool(
    "get_stats",
    {
      title: "Estatísticas",
      description:
        "Ofensiva (dias seguidos jogando o mínimo diário) atual e recorde, minutos jogados hoje e na semana, médias dos últimos 30 dias e por semana, e os jogos mais jogados no último mês.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    () =>
      run(() => {
        const scope = ctx();
        const { weeks: _weeks, ...stats } = getStats(scope, {
          today: scope.today,
          streakMinMinutes: getSettings(scope).streakMinMinutes,
        });
        return stats;
      }),
  );

  server.registerTool(
    "list_sessions",
    {
      title: "Listar sessões",
      description:
        "Sessões de jogo encerradas, das mais recentes para as mais antigas. Filtre por jogo (id ou nome) e por período (datas YYYY-MM-DD no fuso do usuário).",
      inputSchema: z.object({
        game: gameRefSchema.optional(),
        from: isoDateSchema.optional().describe("Data inicial (YYYY-MM-DD), inclusive"),
        to: isoDateSchema.optional().describe("Data final (YYYY-MM-DD), inclusive"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: readOnly,
    },
    ({ game, from, to, limit }) =>
      run(() => {
        const scope = ctx();
        const gameId = game === undefined ? undefined : resolveLibraryGame(scope, game).gameId;
        return { today: scope.today, sessions: listSessions(scope, { gameId, from, to, limit }) };
      }),
  );

  server.registerTool(
    "get_active_session",
    {
      title: "Timer rodando",
      description:
        'O timer de sessão ligado agora ("comecei a jogar"), com o jogo e há quantos minutos está rodando. null se nenhum.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    () =>
      run(() => {
        const scope = ctx();
        const active = getActiveSession(scope);
        if (!active) return { active: null };
        const elapsedMinutes = Math.floor(
          (scope.now.getTime() - Date.parse(active.startedAt)) / 60_000,
        );
        return { active: { ...active, elapsedMinutes } };
      }),
  );

  return server;
}

function hours(seconds: number | null): number | null {
  return seconds === null ? null : Math.round((seconds / 3600) * 10) / 10;
}
