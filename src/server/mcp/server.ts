import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  type AchievementItem,
  type AchievementSetItem,
  type AchievementWriteResult,
  achievementSourceLabels,
  achievementSourceSchema,
} from "../../shared/achievements";
import { isoDateSchema, localTimeSchema } from "../../shared/dates";
import { type CompletionItem, displayStateLabels } from "../../shared/completions";
import {
  completionTypeLabels,
  completionTypeSchema,
  gameStatusLabels,
  gameStatusSchema,
  playtimeSourceSchema,
} from "../../shared/domain";
import { feedKeys, feedTitles } from "../../shared/feeds";
import { genreLabel } from "../../shared/genres";
import { type LibraryItem, priorMinutesSchema } from "../../shared/library";
import {
  addObjectiveSchema,
  MAX_OBJECTIVE_TARGET,
  type ObjectiveItem,
  type ObjectiveWriteResult,
} from "../../shared/objectives";
import { sessionLengthBuckets } from "../../shared/stats";
import { type LogSessionResult, noteSchema } from "../../shared/sessions";
import type { AppDeps } from "../app";
import { AppError, TimerActiveError } from "../errors";
import {
  findSetCandidates,
  linkSet,
  listGameAchievements,
  resolveAchievement,
  setAchievementUnlocked,
} from "../services/achievements";
import {
  getCompletion,
  listCompletions,
  markCompleted,
  removeCompletion,
} from "../services/completions";
import { createContext, type ServiceContext } from "../services/context";
import {
  addToLibrary,
  getLibraryItem,
  listLibrary,
  resolveLibraryGame,
  updateLibraryEntry,
} from "../services/library";
import {
  addObjective,
  deleteObjective,
  getObjective,
  incrementObjective,
  listObjectives,
  setObjectiveDone,
  updateObjective,
} from "../services/objectives";
import { listSessions, logSession } from "../services/sessions";
import { getSettings } from "../services/settings";
import { syncSteamGame, syncSteamLibrary } from "../services/steam-sync";
import { getHeatmap, getPeriodBreakdown, getRecords, getRhythm, getStats } from "../services/stats";
import { getActiveSession, startTimer, stopTimer } from "../services/timer";

// Servidor MCP do Zerômetro: tools finas por cima dos `services/` (as mesmas regras da API
// REST), sempre no escopo do usuário dono do access token e com actor "mcp".

export type McpDeps = Pick<
  AppDeps,
  "db" | "igdb" | "feeds" | "achievements" | "steamUser" | "clock"
>;

const gameRefSchema = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .describe('Id do jogo na biblioteca ou parte do nome (ex.: 12 ou "persona 5")');

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
/** Escrita que só acrescenta ou altera (nada é apagado). */
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
/** Apaga algo: só executa com `confirm: true`; sem isso, devolve o que seria apagado. */
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const confirmSchema = z
  .boolean()
  .optional()
  .describe("true só depois de o usuário confirmar; sem isso, a tool só mostra o que apagaria");

function confirmationNeeded(wouldDelete: unknown) {
  return {
    confirmationNeeded: true,
    wouldDelete,
    message: "Nada foi apagado. Confirme com o usuário e chame de novo com confirm: true.",
  };
}

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
    /** Total que vale para o progresso (pelas sessões + tempo anterior, ou pela Steam). */
    minutesPlayed: item.minutesPlayed,
    sessionMinutes: item.sessionMinutes,
    priorMinutes: item.priorMinutes,
    /** sessions = controle manual; steam = o total vem da Steam (sync_steam). */
    playtimeSource: item.playtimeSource,
    steamPlaytime: item.steamPlaytime,
    displayState: item.displayState,
    displayStateLabel:
      item.displayState === "postgame"
        ? displayStateLabels.postgame
        : gameStatusLabels[item.displayState],
    /** Até onde chegou (null se nunca zerou). Independe do status: pós-jogo = jogando + zerado. */
    completion: item.completion && {
      ...item.completion,
      bestLabel: completionTypeLabels[item.completion.best],
    },
    progressPercent: item.progress === null ? null : Math.round(item.progress * 100),
    /** Para onde o progresso aponta: história antes de zerar; depois extras e 100%. */
    progressTarget: item.progressTarget,
    objectives: item.objectives,
    /** Conquistas das listas da Steam/RA que o jogo segue (null se não segue nenhuma). */
    achievements: item.achievements,
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
    "get_feeds",
    {
      title: "Listas do IGDB (bem avaliados, em alta, próximos)",
      description:
        'As listas da tela inicial, atualizadas 1x por dia a partir do IGDB: top_rated (lançamentos dos últimos meses com melhor nota da crítica), trending (lançados no último ano que mais gente quer jogar no IGDB) e upcoming (próximos lançamentos por expectativa). Cada jogo diz se já está na biblioteca do usuário. Ex.: "o que está em alta?", "o que lança em breve?". Para adicionar um, use add_game com o igdbId.',
      inputSchema: z.object({
        list: z.enum(feedKeys).optional().describe("Só uma das listas; omita para todas"),
        limit: z.number().int().min(1).max(20).default(10).describe("Jogos por lista"),
      }),
      annotations: readOnly,
    },
    ({ list, limit }) =>
      run(async () => {
        const inLibrary = new Map(listLibrary(ctx()).map((item) => [item.igdbId, item]));
        const feeds = (await deps.feeds.getFeeds()).filter((f) => !list || f.key === list);
        return {
          lists: feeds.map((feed) => ({
            list: feed.key,
            title: feedTitles[feed.key],
            updatedAt: feed.updatedAt,
            games: feed.games.slice(0, limit).map((game) => {
              const entry = inLibrary.get(game.igdbId);
              return {
                igdbId: game.igdbId,
                name: game.name,
                releaseDate: game.releaseDate,
                releasePrecision: game.releasePrecision,
                criticRating: game.criticRating,
                hypes: game.hypes,
                genres: game.genres,
                platforms: game.platforms,
                inLibrary: entry ? { gameId: entry.gameId, status: entry.status } : null,
              };
            }),
          })),
        };
      }),
  );

  server.registerTool(
    "list_library",
    {
      title: "Listar biblioteca",
      description:
        'Lista os jogos da biblioteca do usuário, com status, conclusões (zerado, 100%), tempo jogado e progresso estimado. Filtre por status (playing = jogando, finished = zerado e parado, backlog = próximos, wishlist = desejos, paused, dropped), por display_state "postgame" (jogando um jogo já zerado) e/ou parte do nome.',
      inputSchema: z.object({
        status: gameStatusSchema.optional(),
        display_state: z
          .literal("postgame")
          .optional()
          .describe("Só os jogos em pós-jogo (jogando e já zerados)"),
        query: z.string().trim().max(100).optional().describe("Parte do nome"),
      }),
      annotations: readOnly,
    },
    ({ status, display_state, query }) =>
      run(() => ({
        games: listLibrary(ctx(), { status, displayState: display_state, q: query }).map(
          gameSummary,
        ),
      })),
  );

  server.registerTool(
    "get_game",
    {
      title: "Detalhes de um jogo",
      description:
        "Detalhes de um jogo da biblioteca: status, conclusões (história, extras, 100%, com datas e ids), objetivos (com ids e progresso), tempos para zerar (IGDB), total jogado, progresso, nota, anotações e as últimas sessões. Aceita id ou nome; se o nome for ambíguo, devolve as opções.",
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
          completions: listCompletions(scope, item.gameId).map(completionSummary),
          objectives: listObjectives(scope, item.gameId).map(objectiveSummary),
          achievementSets: listGameAchievements(scope, deps.achievements, item.gameId).sets.map(
            setSummary,
          ),
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
        "Ofensiva (dias seguidos jogando o mínimo diário) atual e recorde, minutos jogados hoje e na semana, médias dos últimos 30 dias e por semana, e os jogos mais jogados no último mês. Para um ano ou os últimos 12 meses (gêneros, horários, recordes, zerados), use get_period_stats.",
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
    "get_period_stats",
    {
      title: "Estatísticas de um período",
      description:
        "Estatísticas dos últimos 12 meses (padrão) ou de um ano: total jogado e dias jogados, gêneros e jogos mais jogados, média por dia da semana (0 = segunda), minutos por hora do dia (só sessões de timer), sessões por faixa de duração, recordes (maior sessão, melhor dia e semana), zerados no período e o ritmo comparado ao tempo da história no IGDB (paceRatio 1.2 = 20% a mais).",
      inputSchema: z.object({
        year: z
          .number()
          .int()
          .min(2000)
          .max(2100)
          .optional()
          .describe("Ano de calendário; sem ano, os últimos 12 meses"),
      }),
      annotations: readOnly,
    },
    ({ year }) =>
      run(() => {
        const scope = ctx();
        const { today, timeZone } = scope;
        const heatmap = getHeatmap(scope, {
          today,
          streakMinMinutes: getSettings(scope).streakMinMinutes,
          year,
        });
        const breakdown = getPeriodBreakdown(scope, { today, year });
        const rhythm = getRhythm(scope, { today, timeZone, year });
        const records = getRecords(scope, { today, year });
        return {
          today,
          from: heatmap.from,
          to: heatmap.to,
          yearsWithData: heatmap.years,
          totalMinutes: heatmap.totalMinutes,
          playedDays: heatmap.playedDays,
          genres: breakdown.genres.map(({ genre, minutes, games }) => ({
            genre: genreLabel(genre),
            minutes,
            games,
          })),
          topGames: breakdown.games,
          weekdays: rhythm.weekdays,
          // Só as horas com tempo, para não ocupar contexto à toa.
          hours: rhythm.hours.filter((h) => h.minutes > 0),
          timerSessions: rhythm.timerSessions,
          sessionLengths: sessionLengthBuckets.map(({ min, max }, i) => ({
            minMinutes: min,
            maxMinutes: max,
            sessions: rhythm.sessionLengths[i] ?? 0,
          })),
          sessions: rhythm.sessions,
          medianSessionMinutes: rhythm.medianSessionMinutes,
          longestSession: records.longestSession,
          bestDay: records.bestDay,
          bestWeek: records.bestWeek,
          /** Jogos com conclusão no período (replays e 100% contados à parte). */
          finishedSummary: records.finishedSummary,
          finished: records.finished,
          finishedByMonth: records.finishedByMonth.filter((m) => m.count > 0),
          paceRatio: records.paceRatio,
        };
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
        'Registra uma sessão já jogada, sem timer ("joguei 2h de Persona ontem"). Converta a duração para minutos. playedOn é a data local (YYYY-MM-DD), padrão hoje; não pode ser no futuro e o dia não passa de 24h somando todos os jogos. Jogo em Próximos/Desejos/Pausado passa para Jogando. Cada chamada cria uma sessão nova: não repita se a primeira deu certo. Para horas jogadas antes de usar o Zerômetro, sem dia certo ("já tenho 39h disso"), use set_prior_playtime em vez de inventar sessões.',
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
        priorMinutes: priorMinutesSchema
          .optional()
          .describe(
            'Minutos já jogados antes de usar o Zerômetro (ex.: "já tenho 39h" → 2340). Veja set_prior_playtime.',
          ),
      }),
      annotations: { ...write, openWorldHint: true },
    },
    ({ igdbId, status, platformPlayed, priorMinutes }) =>
      run(async () =>
        gameSummary(
          await addToLibrary(ctx(), deps.igdb, { igdbId, status, platformPlayed, priorMinutes }),
        ),
      ),
  );

  server.registerTool(
    "set_prior_playtime",
    {
      title: "Tempo jogado antes do Zerômetro",
      description:
        'Define quanto o usuário jogou de um jogo antes de começar a registrar no Zerômetro ("já tenho 39h de Witcher 3"). Substitui o valor anterior (não soma). Esse tempo não tem data: entra no total e no progresso do jogo, mas não nas estatísticas (ofensiva, médias, semanas, mais jogados). Para tempo jogado num dia específico, use log_session. Se o jogo usa o tempo da Steam (playtimeSource steam), este valor fica guardado mas só conta quando voltar para as sessões (set_playtime_source).',
      inputSchema: z.object({
        game: gameRefSchema,
        minutes: priorMinutesSchema.describe("Total de minutos jogados antes (0 para limpar)"),
      }),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, minutes }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        return gameSummary(updateLibraryEntry(scope, gameId, { priorMinutes: minutes }).item);
      }),
  );

  server.registerTool(
    "set_status",
    {
      title: "Mudar status",
      description:
        'Muda o status de um jogo da biblioteca ("larguei Y", "vou jogar Z depois", "terminei e parei de jogar X"). playing preenche a data de início se vazia; finished preenche a data de término (hoje, ou finishedAt) e, se o jogo não tiver nenhuma conclusão, registra a da história nessa data; sair de finished não apaga conclusões. Para registrar que zerou (inclusive extras/100% ou continuando a jogar), prefira mark_completed. Datas no formato YYYY-MM-DD, nunca no futuro.',
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

  // -------------------------------------------------------------------------
  // Conclusões e objetivos

  server.registerTool(
    "mark_completed",
    {
      title: "Zerei",
      description:
        'Registra que o usuário zerou um jogo: type main = história ("zerei o Persona"), extras = história + extras, full = 100%/platina ("platinei", "fiz 100%"). Replays viram outra conclusão. Não muda o status por padrão: um jogo em "jogando" fica em pós-jogo ("zerei o Ocarina mas vou continuar jogando"). Se o usuário disser que terminou de vez, passe move_to_finished: true; se não ficar claro, registre e pergunte. Data padrão: hoje (YYYY-MM-DD, nunca no futuro).',
      inputSchema: z.object({
        game: gameRefSchema,
        type: completionTypeSchema.default("main"),
        date: isoDateSchema.optional().describe("Quando zerou (YYYY-MM-DD); padrão hoje"),
        note: z.string().trim().max(500).optional().describe("Ex.: final verdadeiro, NG+"),
        move_to_finished: z
          .boolean()
          .optional()
          .describe("Também move o jogo para Zerados (finished)"),
      }),
      annotations: write,
    },
    ({ game, type, date, note, move_to_finished }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        const { completion, item, previousStatus } = markCompleted(scope, gameId, {
          type,
          date,
          note,
          moveToFinished: move_to_finished,
        });
        return {
          completion: completionSummary(completion),
          game: gameSummary(item),
          previousStatus,
          ...(item.displayState === "postgame" && {
            hint: "O jogo continua em Jogando (pós-jogo). Se o usuário parou de jogar, use set_status com finished (não duplica a conclusão).",
          }),
        };
      }),
  );

  server.registerTool(
    "remove_completion",
    {
      title: "Apagar conclusão",
      description:
        "Apaga uma conclusão registrada por engano (o status do jogo não muda). Pegue o id em get_game. Sem confirm: true, só mostra o que seria apagado: confirme com o usuário antes.",
      inputSchema: z.object({
        completion_id: z.number().int().positive(),
        confirm: confirmSchema,
      }),
      annotations: destructive,
    },
    ({ completion_id, confirm }) =>
      run(() => {
        const scope = ctx();
        if (confirm !== true) return confirmationNeeded(getCompletion(scope, completion_id));
        const { removed, item } = removeCompletion(scope, completion_id);
        return { removed: completionSummary(removed), game: gameSummary(item) };
      }),
  );

  server.registerTool(
    "list_objectives",
    {
      title: "Objetivos de um jogo",
      description:
        "Lista os objetivos de um jogo (checkbox ou contador, ex.: 900 sementes Korok), com ids e progresso. Use antes de update_objective para achar o id.",
      inputSchema: z.object({ game: gameRefSchema }),
      annotations: readOnly,
    },
    ({ game }) =>
      run(() => {
        const scope = ctx();
        const item = resolveLibraryGame(scope, game);
        return {
          gameId: item.gameId,
          name: item.name,
          objectives: listObjectives(scope, item.gameId).map(objectiveSummary),
          summary: item.objectives ?? { total: 0, unlocked: 0 },
        };
      }),
  );

  server.registerTool(
    "add_objective",
    {
      title: "Adicionar objetivo",
      description:
        'Cria um objetivo num jogo ("adiciona o objetivo 900 sementes Korok no BotW"): target 1 (padrão) é um checkbox; maior que 1, um contador que começa em 0.',
      inputSchema: z.object({
        game: gameRefSchema,
        title: addObjectiveSchema.shape.title.describe("Ex.: Sementes Korok"),
        target: z.number().int().min(1).max(MAX_OBJECTIVE_TARGET).optional(),
        description: z.string().trim().max(500).optional(),
      }),
      annotations: write,
    },
    ({ game, title, target, description }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        return objectiveWritten(addObjective(scope, gameId, { title, target, description }));
      }),
  );

  server.registerTool(
    "update_objective",
    {
      title: "Atualizar objetivo",
      description:
        'Atualiza um objetivo (id em list_objectives): increment soma ao progresso ("peguei mais 3 sementes" → increment 3; negativo desfaz), progress define o valor, done marca/desmarca de vez. Use só um dos três. Também renomeia (title) ou muda o alvo (target). O progresso fica entre 0 e o alvo. Se a resposta trouxer suggestFullCompletion, pergunte se quer marcar o jogo como 100% (mark_completed com full).',
      inputSchema: z
        .object({
          objective_id: z.number().int().positive(),
          increment: z
            .number()
            .int()
            .min(-MAX_OBJECTIVE_TARGET)
            .max(MAX_OBJECTIVE_TARGET)
            .optional(),
          progress: z.number().int().min(0).optional(),
          done: z.boolean().optional(),
          title: addObjectiveSchema.shape.title.optional(),
          target: z.number().int().min(1).max(MAX_OBJECTIVE_TARGET).optional(),
          description: z.string().trim().max(500).nullable().optional(),
        })
        .refine(
          (v) => [v.increment, v.progress, v.done].filter((x) => x !== undefined).length <= 1,
          "Use só um entre increment, progress e done",
        )
        .refine((v) => Object.keys(v).some((key) => key !== "objective_id"), "Nada para atualizar"),
      annotations: write,
    },
    ({ objective_id: id, increment, progress, done, title, target, description }) =>
      run(() => {
        const scope = ctx();
        let result: ObjectiveWriteResult | null = null;
        const patch = {
          ...(title !== undefined && { title }),
          ...(target !== undefined && { target }),
          ...(description !== undefined && { description }),
          ...(progress !== undefined && { progress }),
        };
        if (Object.keys(patch).length > 0) result = updateObjective(scope, id, patch);
        if (increment !== undefined) result = incrementObjective(scope, id, increment);
        if (done !== undefined) result = setObjectiveDone(scope, id, done);
        return objectiveWritten(result ?? updateObjective(scope, id, {}));
      }),
  );

  server.registerTool(
    "delete_objective",
    {
      title: "Apagar objetivo",
      description:
        "Apaga um objetivo (id em list_objectives). Sem confirm: true, só mostra o que seria apagado: confirme com o usuário antes.",
      inputSchema: z.object({
        objective_id: z.number().int().positive(),
        confirm: confirmSchema,
      }),
      annotations: destructive,
    },
    ({ objective_id, confirm }) =>
      run(() => {
        const scope = ctx();
        if (confirm !== true) {
          return confirmationNeeded(objectiveSummary(getObjective(scope, objective_id)));
        }
        const { deleted, summary } = deleteObjective(scope, objective_id);
        return { deleted: objectiveSummary(deleted), summary };
      }),
  );

  server.registerTool(
    "list_achievements",
    {
      title: "Conquistas de um jogo",
      description:
        "Lista as conquistas das listas da Steam/RetroAchievements que o jogo segue, com ids, se já foram desbloqueadas, raridade (% dos jogadores) e pontos (RA). Secretas ainda trancadas vêm sem nome e descrição: não revele, a menos que o usuário peça. Se o jogo não segue nenhuma lista, use link_achievement_set.",
      inputSchema: z.object({
        game: gameRefSchema,
        filter: z
          .enum(["all", "missing", "unlocked"])
          .optional()
          .describe("missing = faltando; unlocked = desbloqueadas (padrão: all)"),
        reveal_secrets: z
          .boolean()
          .optional()
          .describe("true só se o usuário pedir spoiler das conquistas secretas"),
      }),
      annotations: readOnly,
    },
    ({ game, filter = "all", reveal_secrets }) =>
      run(() => {
        const scope = ctx();
        const item = resolveLibraryGame(scope, game);
        const data = listGameAchievements(scope, deps.achievements, item.gameId);
        return {
          gameId: item.gameId,
          name: item.name,
          summary: data.summary,
          sets: data.sets.map((set) => ({
            ...setSummary(set),
            achievements: set.achievements
              .filter((a) => matchesFilter(a, filter))
              .map((a) => achievementSummary(a, reveal_secrets === true)),
          })),
          ...(data.sets.length === 0 && {
            hint: "O jogo não segue nenhuma lista: use link_achievement_set.",
          }),
        };
      }),
  );

  server.registerTool(
    "link_achievement_set",
    {
      title: "Ligar lista de conquistas",
      description:
        "Liga ao jogo a lista de conquistas da Steam ou do RetroAchievements. Sem external_id: na Steam liga a do appid que o IGDB conhece; no RA (ou se a Steam não tiver), só devolve as sugestões (busca pelo nome nos consoles do jogo) para o usuário escolher. Com external_id (id ou URL da loja/página do RA), liga essa.",
      inputSchema: z.object({
        game: gameRefSchema,
        source: achievementSourceSchema.describe("steam ou retroachievements"),
        external_id: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .optional()
          .describe("Id ou URL do jogo na fonte (ex.: 504230 ou retroachievements.org/game/1446)"),
        search: z
          .string()
          .trim()
          .min(2)
          .max(100)
          .optional()
          .describe("Outro nome para buscar no RA"),
      }),
      annotations: { ...write, openWorldHint: true },
    },
    ({ game, source, external_id, search }) =>
      run(async () => {
        const scope = ctx();
        const item = resolveLibraryGame(scope, game);
        let id = external_id;
        if (!id) {
          const found = await findSetCandidates(scope, deps.achievements, deps.igdb, item.gameId, {
            ...(search && { q: search }),
          });
          const steam = found.candidates.find((c) => c.source === "steam");
          if (source === "steam" && steam) {
            id = steam.externalId;
          } else {
            return {
              linked: false,
              candidates: found.candidates
                .filter((c) => c.source === source)
                .map(
                  ({ externalId, title, platform, achievementsCount, points, subset, linked }) => ({
                    externalId,
                    title,
                    platform,
                    achievementsCount,
                    points,
                    subset,
                    linked,
                  }),
                ),
              errors: found.errors,
              message: `Nada foi ligado. Mostre as opções ao usuário e chame de novo com external_id (${achievementSourceLabels[source]}).`,
            };
          }
        }
        const result = await linkSet(scope, deps.achievements, item.gameId, { source, id });
        return { linked: true, summary: result.summary, sets: result.sets.map(setSummary) };
      }),
  );

  server.registerTool(
    "set_achievement",
    {
      title: "Marcar conquista",
      description:
        'Marca (ou desmarca, com unlocked: false) uma conquista das listas do jogo, pelo id (em list_achievements) ou pelo nome aproximado ("peguei a conquista Farewell do Celeste"). Nome ambíguo devolve as opções. Se a resposta trouxer suggestFullCompletion, pergunte se quer marcar o jogo como 100% (mark_completed com full).',
      inputSchema: z.object({
        game: gameRefSchema,
        achievement: z
          .union([z.number().int().positive(), z.string().trim().min(1).max(200)])
          .describe("Id da conquista ou parte do nome"),
        unlocked: z.boolean().default(true),
        date: isoDateSchema.optional().describe("Dia em que desbloqueou (padrão: agora)"),
      }),
      annotations: write,
    },
    ({ game, achievement, unlocked, date }) =>
      run(() => {
        const scope = ctx();
        const item = resolveLibraryGame(scope, game);
        const target = resolveAchievement(scope, deps.achievements, item.gameId, achievement);
        const result = setAchievementUnlocked(scope, deps.achievements, item.gameId, target.id, {
          unlocked,
          ...(date && { unlockedOn: date }),
        });
        return achievementWritten(result);
      }),
  );

  server.registerTool(
    "sync_steam",
    {
      title: "Sincronizar com a Steam",
      description:
        "Traz da conta Steam do usuário (o perfil conectado nos Ajustes do site) as conquistas desbloqueadas, com a data real, e o tempo total de cada jogo. Com game: só esse jogo; sem game: todos os da biblioteca que estão na conta (pode levar um tempo). Só adiciona desbloqueios, nunca desmarca. Um jogo na conta sem lista de conquistas ganha a da Steam. O tempo da Steam fica guardado à parte (steamPlaytime): só vira o tempo jogado se o jogo usar a Steam como fonte (set_playtime_source). Se o perfil não estiver conectado ou esconder os jogos, a mensagem de erro diz o que o usuário precisa fazer.",
      inputSchema: z.object({
        game: gameRefSchema.optional().describe("Um jogo só; omita para sincronizar todos"),
      }),
      annotations: { ...write, openWorldHint: true },
    },
    ({ game }) =>
      run(async () => {
        const scope = ctx();
        const steamDeps = {
          catalog: deps.achievements,
          igdb: deps.igdb,
          steamUser: deps.steamUser,
        };
        if (game !== undefined) {
          const { gameId } = resolveLibraryGame(scope, game);
          const sync = await syncSteamGame(scope, steamDeps, gameId);
          return { sync, game: gameSummary(getLibraryItem(scope, gameId)) };
        }
        const result = await syncSteamLibrary(scope, steamDeps);
        return {
          syncedAt: result.syncedAt,
          newUnlocks: result.newUnlocks,
          games: result.games
            .filter((g) => g.owned || g.newUnlocks > 0 || g.error)
            .map(({ gameId, name, steamMinutes, newUnlocks, linkedSet, error }) =>
              Object.assign(
                { gameId, name, steamMinutes, newUnlocks },
                linkedSet && { linkedSet },
                error && { error },
              ),
            ),
        };
      }),
  );

  server.registerTool(
    "set_playtime_source",
    {
      title: "Fonte do tempo jogado",
      description:
        'Escolhe de onde vem o tempo jogado de um jogo: "sessions" (controle manual: sessões registradas + tempo antes do Zerômetro) ou "steam" (o total da Steam, da última sync_steam). As sessões continuam contando na ofensiva e nas estatísticas nos dois casos. Para usar "steam", sincronize o jogo antes.',
      inputSchema: z.object({
        game: gameRefSchema,
        source: playtimeSourceSchema.describe("sessions ou steam"),
      }),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, source }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        return gameSummary(updateLibraryEntry(scope, gameId, { playtimeSource: source }).item);
      }),
  );

  return server;
}

function hours(seconds: number | null): number | null {
  return seconds === null ? null : Math.round((seconds / 3600) * 10) / 10;
}

function completionSummary({ id, type, completedOn, note }: CompletionItem) {
  return { id, type, typeLabel: completionTypeLabels[type], completedOn, note };
}

function objectiveSummary(o: ObjectiveItem) {
  return {
    id: o.id,
    title: o.title,
    description: o.description,
    progress: o.progress,
    target: o.target,
    done: o.progress >= o.target,
    source: o.source,
  };
}

function objectiveWritten(result: ObjectiveWriteResult) {
  return {
    objective: objectiveSummary(result.objective),
    summary: result.summary,
    allDoneNow: result.allDoneNow,
    suggestFullCompletion: result.suggestFullCompletion,
    ...(result.suggestFullCompletion && {
      hint: "Todos os objetivos concluídos: pergunte se o usuário quer marcar o jogo como 100% (mark_completed com type full).",
    }),
  };
}

function matchesFilter(a: AchievementItem, filter: "all" | "missing" | "unlocked") {
  return filter === "all" || (filter === "unlocked") === (a.unlockedAt !== null);
}

function setSummary(set: AchievementSetItem) {
  return {
    setId: set.id,
    source: set.source,
    sourceLabel: achievementSourceLabels[set.source],
    title: set.title,
    platform: set.platform,
    url: set.url,
    total: set.total,
    unlocked: set.unlocked,
    ...(set.points > 0 && { points: set.points, pointsUnlocked: set.pointsUnlocked }),
  };
}

/** Secreta ainda trancada vai sem nome e descrição (spoiler), a menos que peçam. */
function achievementSummary(a: AchievementItem, revealSecrets = true) {
  const hide = a.hidden && !a.unlockedAt && !revealSecrets;
  return {
    id: a.id,
    title: hide ? null : a.title,
    description: hide ? null : a.description,
    secret: a.hidden,
    unlocked: a.unlockedAt !== null,
    unlockedAt: a.unlockedAt,
    rarityPercent: a.rarity === null ? null : Math.round(a.rarity * 10) / 10,
    points: a.points,
    ...(a.removed && { removedFromSource: true }),
  };
}

function achievementWritten(result: AchievementWriteResult) {
  return {
    achievements: result.achievements.map((a) => achievementSummary(a)),
    summary: result.summary,
    allDoneNow: result.allDoneNow,
    suggestFullCompletion: result.suggestFullCompletion,
    ...(result.suggestFullCompletion && {
      hint: "Todas as conquistas desbloqueadas: pergunte se o usuário quer marcar o jogo como 100% (mark_completed com type full).",
    }),
  };
}
