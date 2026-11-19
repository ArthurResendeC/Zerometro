import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isoDateSchema, localTimeSchema } from "../../shared/dates";
import { gameStatusLabels, gameStatusSchema } from "../../shared/domain";
import type { LibraryItem } from "../../shared/library";
import { type LogSessionResult, noteSchema } from "../../shared/sessions";
import type { AppDeps } from "../app";
import { AppError, TimerActiveError } from "../errors";
import { createContext, type ServiceContext } from "../services/context";
import {
  addToLibrary,
  listLibrary,
  resolveLibraryGame,
  updateLibraryEntry,
} from "../services/library";
import { listSessions, logSession } from "../services/sessions";
import { getSettings } from "../services/settings";
import { getStats } from "../services/stats";
import { getActiveSession, startTimer, stopTimer } from "../services/timer";

// Servidor MCP do Zerômetro: tools finas por cima dos `services/` (as mesmas regras da API
// REST), sempre no escopo do usuário dono do access token e com actor "mcp".

export type McpDeps = Pick<AppDeps, "db" | "igdb" | "clock">;

const gameRefSchema = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .describe('Id do jogo na biblioteca ou parte do nome (ex.: 12 ou "persona 5")');

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
/** Escrita que só acrescenta ou altera (nada é apagado). */
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

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
    const hint =
      error instanceof TimerActiveError
        ? " Pergunte ao usuário se quer encerrar essa sessão e começar a nova; se sim, chame de novo com replaceActive: true."
        : "";
    return { isError: true, content: [{ type: "text" as const, text: error.message + hint }] };
  }
}

/** Sessão registrada, com os totais e a ofensiva (para o modelo comentar o progresso). */
function sessionLogged(result: LogSessionResult) {
  return {
    session: result.session,
    dayTotalMinutes: result.dayTotalMinutes,
    gameTotalMinutes: result.gameTotalMinutes,
    statusChangedTo: result.statusChangedTo,
    streak: result.streak,
  };
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

  // -------------------------------------------------------------------------
  // Escrita (sem apagar nada; remoções e edições de sessão ficam para depois, com confirmação)

  server.registerTool(
    "start_session",
    {
      title: "Comecei a jogar",
      description:
        'Liga o timer de sessão de um jogo da biblioteca ("comecei a jogar X"). O tempo conta no servidor até stop_session; aparece também no site. Se o mesmo jogo já está rodando, não muda nada. Se outro jogo está rodando, dá erro: pergunte ao usuário e, se ele quiser trocar, chame de novo com replaceActive: true (a sessão anterior é encerrada e registrada). Jogo em Próximos/Desejos/Pausado passa para Jogando.',
      inputSchema: z.object({
        game: gameRefSchema,
        replaceActive: z
          .boolean()
          .optional()
          .describe("Encerra o timer de outro jogo que esteja rodando e começa este"),
      }),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, replaceActive }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        const result = startTimer(scope, { gameId, replaceActive });
        return {
          active: result.active,
          alreadyRunning: result.alreadyRunning,
          statusChangedTo: result.statusChangedTo,
          stoppedPrevious: result.stopped,
        };
      }),
  );

  server.registerTool(
    "stop_session",
    {
      title: "Parei de jogar",
      description:
        'Desliga o timer rodando e registra a sessão no dia em que começou ("parei"). Se o usuário esqueceu o timer ligado, passe endTime com o horário local em que parou (HH:MM; se for antes do início, é no dia seguinte). Menos de 1 minuto sem endTime é descartado. Erro se nenhum timer estiver rodando.',
      inputSchema: z.object({
        endTime: localTimeSchema.optional().describe("Horário local em que parou (HH:MM)"),
        note: noteSchema.optional().describe("Anotação curta sobre a sessão"),
      }),
      annotations: write,
    },
    ({ endTime, note }) =>
      run(() => {
        const result = stopTimer(ctx(), { endTime, note });
        return result.discarded ? result : { discarded: false, ...sessionLogged(result) };
      }),
  );

  server.registerTool(
    "log_session",
    {
      title: "Registrar sessão",
      description:
        'Registra uma sessão já jogada, sem timer ("joguei 2h de Persona ontem"). Converta a duração para minutos. playedOn é a data local (YYYY-MM-DD), padrão hoje; não pode ser no futuro e o dia não passa de 24h somando todos os jogos. Jogo em Próximos/Desejos/Pausado passa para Jogando. Cada chamada cria uma sessão nova: não repita se a primeira deu certo.',
      inputSchema: z.object({
        game: gameRefSchema,
        minutes: z.number().int().min(1).max(1440).describe("Duração em minutos"),
        playedOn: isoDateSchema.optional().describe("Dia em que jogou (YYYY-MM-DD); padrão hoje"),
        note: noteSchema.optional().describe("Anotação curta sobre a sessão"),
      }),
      annotations: { ...write, idempotentHint: false },
    },
    ({ game, minutes, playedOn, note }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        return sessionLogged(logSession(scope, { gameId, minutes, playedOn, note }));
      }),
  );

  server.registerTool(
    "add_game",
    {
      title: "Adicionar jogo",
      description:
        "Adiciona um jogo do IGDB à biblioteca. Use search_igdb antes para achar o igdbId (confirme com o usuário se houver várias edições). Status: backlog (próximos), wishlist (desejos), playing (jogando), finished (zerado), paused, dropped. Erro se o jogo já estiver na biblioteca.",
      inputSchema: z.object({
        igdbId: z.number().int().positive().describe("Id do jogo no IGDB (de search_igdb)"),
        status: gameStatusSchema.default("backlog"),
        platformPlayed: z
          .string()
          .trim()
          .min(1)
          .max(50)
          .optional()
          .describe('Plataforma em que vai jogar (ex.: "PS5", "Switch", "PC")'),
      }),
      annotations: { ...write, openWorldHint: true },
    },
    ({ igdbId, status, platformPlayed }) =>
      run(async () =>
        gameSummary(await addToLibrary(ctx(), deps.igdb, { igdbId, status, platformPlayed })),
      ),
  );

  server.registerTool(
    "set_status",
    {
      title: "Mudar status",
      description:
        'Muda o status de um jogo da biblioteca ("zerei X", "larguei Y", "vou jogar Z depois"). playing preenche a data de início se vazia; finished preenche a data de término (hoje, ou finishedAt); sair de finished limpa a data de término. Datas no formato YYYY-MM-DD, nunca no futuro.',
      inputSchema: z.object({
        game: gameRefSchema,
        status: gameStatusSchema,
        startedAt: isoDateSchema.optional().describe("Quando começou (YYYY-MM-DD)"),
        finishedAt: isoDateSchema.optional().describe("Quando zerou (YYYY-MM-DD), com finished"),
      }),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, status, startedAt, finishedAt }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        const { item, previousStatus } = updateLibraryEntry(scope, gameId, {
          status,
          ...(startedAt && { startedAt }),
          ...(finishedAt && { finishedAt }),
        });
        return { ...gameSummary(item), previousStatus };
      }),
  );

  return server;
}

function hours(seconds: number | null): number | null {
  return seconds === null ? null : Math.round((seconds / 3600) * 10) / 10;
}
