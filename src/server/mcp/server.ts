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
import {
  type CompletionItem,
  displayStateLabels,
  MAX_GOAL_MINUTES,
  progressGoalLabels,
  progressGoals,
} from "../../shared/completions";
import {
  completionTypeLabels,
  completionTypeSchema,
  gameStatusLabels,
  gameStatusSchema,
  playtimeSourceSchema,
} from "../../shared/domain";
import { feedKeys, feedTitles } from "../../shared/feeds";
import { genreLabel } from "../../shared/genres";
import { gameModeLabel, perspectiveLabel, themeLabel } from "../../shared/game-labels";
import {
  type LibraryItem,
  type Purchase,
  librarySortSchema,
  priorMinutesSchema,
  sortDirectionSchema,
  sortLibraryItems,
} from "../../shared/library";
import {
  addObjectiveSchema,
  MAX_OBJECTIVE_TARGET,
  type ObjectiveItem,
  type ObjectiveWriteResult,
} from "../../shared/objectives";
import {
  MIN_RATED_GAMES,
  type ProfileSection,
  profileSortSchema,
  type ProfileRow,
  sortProfileRows,
} from "../../shared/profile";
import { recapImageFormats, recapPeriods } from "../../shared/recap";
import {
  criterionGroupLabels,
  criteriaById,
  presetDefs,
  presetNotApplicable,
  presetWeights,
  ratingCriteria,
  ratingPresetSchema,
  ratingPresets,
} from "../../shared/rating-criteria";
import {
  type CriterionAverage,
  DIVERGENCE_MESSAGE,
  enjoymentSchema,
  MIN_APPLICABLE_CRITERIA,
  type RatingItem,
  ratingModeLabels,
  ratingModeSchema,
  ratingReviewSchema,
  ratingScoresSchema,
  criterionNotesSchema,
} from "../../shared/ratings";
import {
  availableTimeSchema,
  moodSchema,
  pickSuggestion,
  type Suggestion,
  suggestGames,
} from "../../shared/suggest";
import { recapSlideIds, recapSlides } from "../../shared/recap-slides";
import { profileTitle } from "../../shared/recap-text";
import { sessionLengthBuckets } from "../../shared/stats";
import { timelinePauses } from "../../shared/timeline";
import { formatBrl, MAX_PRICE_CENTS, reaisToCents } from "../../shared/money";
import { type LogSessionResult, noteSchema } from "../../shared/sessions";
import type { AppDeps } from "../app";
import { AppError, TimerActiveError, ValidationError } from "../errors";
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
import { listSessions, logSession, noteLastSession } from "../services/sessions";
import { getSettings } from "../services/settings";
import { getWallet } from "../services/economy";
import { importSteamGames, previewSteamImport } from "../services/steam-import";
import {
  getSteamLibrarySyncRun,
  startSteamLibrarySync,
  syncSteamGame,
  waitForSteamLibrarySync,
} from "../services/steam-sync";
import { getProfile } from "../services/profile";
import { getLeaderboard, getMemberGamerProfile, getMemberProfile } from "../services/group";
import { type GroupMemberGame, groupMetrics, groupPeriods } from "../../shared/group";
import { createRating, getLatestRating, getRatingTemplate, listRatings } from "../services/ratings";
import { getRecap } from "../services/recap";
import { renderRecapImage } from "../services/recap-image";
import { getHeatmap, getPeriodBreakdown, getRecords, getRhythm, getStats } from "../services/stats";
import { getTimeline } from "../services/timeline";
import { getPurchaseStats } from "../services/purchases";
import type { PurchaseStats } from "../../shared/purchases";
import type { SteamLibrarySyncRun } from "../../shared/steam";
import { getActiveSession, startTimer, stopTimer } from "../services/timer";

// Servidor MCP do Zerômetro: tools finas por cima dos `services/` (as mesmas regras da API
// REST), sempre no escopo do usuário dono do access token e com actor "mcp".

export type McpDeps = Pick<
  AppDeps,
  "db" | "igdb" | "feeds" | "achievements" | "steamUser" | "recapImages" | "clock"
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
    /** Onde roda a emulação (null = nativo). */
    emulatedOn: item.emulatedOn,
    releaseYear: item.releaseYear,
    /** Total que vale para o progresso (pelas sessões + tempo anterior, ou pela Steam). */
    minutesPlayed: item.minutesPlayed,
    sessionMinutes: item.sessionMinutes,
    priorMinutes: item.priorMinutes,
    /** sessions = controle manual; steam = o total vem da Steam (sync_steam). */
    playtimeSource: item.playtimeSource,
    steamPlaytime: item.steamPlaytime,
    /** false: não está na Steam (sync_steam e o tempo da Steam não valem); null: não conferido. */
    onSteam: item.onSteam,
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
    /** Progresso rumo à meta (null = sem barra). Sem a conclusão marcada, não passa de 99%. */
    progressPercent: item.progress === null ? null : Math.round(item.progress * 100),
    /** Meta da barra: achievements (conquistas), main/extras/full (tempo do IGDB), hours ou none. */
    progressGoal: item.progressGoal,
    progressGoalLabel: progressGoalLabels[item.progressGoal],
    /** false = a meta padrão (conquistas, se segue uma lista; senão história, e sem fim = none). */
    progressGoalCustom: item.progressGoalCustom,
    progressTargetMinutes: item.progressTargetMinutes,
    progressDone: item.progressDone,
    objectives: item.objectives,
    /** Conquistas das listas da Steam/RA que o jogo segue (null se não segue nenhuma). */
    achievements: item.achievements,
    /** Nota final da avaliação atual (0–10, 1 casa); detalhes em get_rating. */
    rating: item.rating === null ? null : round1(item.rating),
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    lastPlayedOn: item.lastPlayedOn,
    firstPlayedOn: item.firstPlayedOn,
    /** "Onde parei": a nota da última sessão que tem nota, com o dia (null se nenhuma tem). */
    lastNote: item.lastNote && { note: item.lastNote.note, playedOn: item.lastNote.playedOn },
    /** Compra (null se nada foi informado); o preço vai em reais e formatado. */
    purchase: item.purchase && purchaseSummary(item.purchase),
  };
}

function purchaseSummary({ acquiredOn, pricePaidCents, store, viaSubscription }: Purchase) {
  return {
    acquiredOn,
    price: pricePaidCents === null ? null : reais(pricePaidCents),
    priceLabel: pricePaidCents === null ? null : formatBrl(pricePaidCents),
    store,
    viaSubscription,
  };
}

const reais = (cents: number) => cents / 100;

/** Comprei × zerei e custo por hora, em reais, sem capas nem ids do IGDB. */
function purchasesSummary(stats: PurchaseStats) {
  return {
    hasPurchases: stats.hasPurchases,
    bought: stats.bought,
    viaSubscription: stats.viaSubscription,
    spent: reais(stats.spentCents),
    spentLabel: formatBrl(stats.spentCents),
    finishedFirstTime: stats.finished,
    byMonth: stats.byMonth
      .filter((m) => m.bought > 0 || m.finished > 0)
      .map(({ month, bought, finished, spentCents }) => ({
        month,
        bought,
        finished,
        spent: reais(spentCents),
      })),
    /** Do mais barato por hora para o mais caro (só com 1h+ jogada). */
    costPerHour: stats.costPerHour.map((game) => ({
      gameId: game.gameId,
      name: game.name,
      price: reais(game.pricePaidCents),
      minutesPlayed: game.minutesPlayed,
      perHour: reais(game.centsPerHour),
      perHourLabel: `${formatBrl(game.centsPerHour)}/h`,
    })),
    averagePerHour: stats.averageCentsPerHour === null ? null : reais(stats.averageCentsPerHour),
    /** Comprados e ainda nunca jogados (de qualquer data). */
    unplayed: stats.unplayed.map((game) => ({
      gameId: game.gameId,
      name: game.name,
      acquiredOn: game.acquiredOn,
      price: game.pricePaidCents === null ? null : reais(game.pricePaidCents),
    })),
    unplayedTotal: reais(stats.unplayedCents),
  };
}

/** Uma sugestão do "o que jogar agora?", com os motivos. */
function suggestionSummary({ item, reasons, remainingMinutes }: Suggestion) {
  return {
    gameId: item.gameId,
    name: item.name,
    status: item.status,
    statusLabel: gameStatusLabels[item.status],
    platformPlayed: item.platformPlayed,
    reasons,
    remainingMinutes,
    progressPercent: item.progress === null ? null : Math.round(item.progress * 100),
    lastNote: item.lastNote && { note: item.lastNote.note, playedOn: item.lastNote.playedOn },
  };
}

export function createMcpServer(deps: McpDeps, userId: string): McpServer {
  const ctx = (): ServiceContext => createContext(deps.db, deps.clock, "mcp", userId);
  const steamDeps = () => ({
    catalog: deps.achievements,
    igdb: deps.igdb,
    steamUser: deps.steamUser,
  });
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
        'Lista os jogos da biblioteca do usuário, com status, conclusões (zerado, 100%), tempo jogado e progresso estimado. Filtre por status (playing = jogando, endless = sem fim (multiplayer, live service: não se zera), finished = zerado e parado, backlog = próximos, wishlist = desejos, paused, dropped), por display_state "postgame" (jogando um jogo já zerado) e/ou parte do nome. Ordene com sort: last_session (última sessão), started_at (quando começou a jogar; sem data de início, a primeira sessão) ou rating (nota do usuário); quem não tem o valor fica no fim.',
      inputSchema: z.object({
        status: gameStatusSchema.optional(),
        display_state: z
          .literal("postgame")
          .optional()
          .describe("Só os jogos em pós-jogo (jogando e já zerados)"),
        query: z.string().trim().max(100).optional().describe("Parte do nome"),
        sort: librarySortSchema
          .optional()
          .describe("Critério de ordenação (sem: jogados recentemente primeiro)"),
        order: sortDirectionSchema
          .optional()
          .describe("desc (padrão): mais recente/maior nota primeiro; asc: o contrário"),
      }),
      annotations: readOnly,
    },
    ({ status, display_state, query, sort, order }) =>
      run(() => {
        const items = listLibrary(ctx(), { status, displayState: display_state, q: query });
        return { games: (sort ? sortLibraryItems(items, sort, order) : items).map(gameSummary) };
      }),
  );

  server.registerTool(
    "get_game",
    {
      title: "Detalhes de um jogo",
      description:
        'Detalhes de um jogo da biblioteca: status, "onde parei" (lastNote: a nota da última sessão anotada, com o dia; use para lembrar o usuário de onde ele parou), conclusões (história, extras, 100%, com datas e ids), objetivos (com ids e progresso), tempos para zerar (IGDB), total jogado, progresso, nota, anotações e as últimas sessões. Aceita id ou nome; se o nome for ambíguo, devolve as opções.',
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
          /** Avaliação atual (a mais recente), com as notas por critério; null sem avaliação. */
          latestRating: ratingSummary(getLatestRating(scope, item.gameId)),
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
    "get_wallet",
    {
      title: "Carteira de moedas",
      description:
        "Saldo de moedas e os lançamentos mais recentes. Moedas vêm de horas jogadas (10 por hora, até 6h por dia) e de conquistas da Steam sincronizadas (5 a 50 pela raridade), só a partir do cadastro do perfil. Servem para comprar temas e sons (em breve, na loja).",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    () => run(() => getWallet(ctx())),
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
        const purchases = getPurchaseStats(scope, { today, year });
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
          /**
           * Comprei × zerei no período (pela data da compra; zerados = primeira vez) e o custo
           * por hora de todas as compras com preço. Valores em reais.
           */
          purchases: purchasesSummary(purchases),
        };
      }),
  );

  server.registerTool(
    "get_timeline",
    {
      title: "Linha do tempo",
      description:
        'Quando joguei cada jogo nos últimos 12 meses (padrão) ou num ano: os trechos contínuos de jogo (from/to, minutos e dias jogados), as pausas de mais de 14 dias sem jogar entre eles e as conclusões. startedBefore/continuesAfter = o trecho atravessa a borda do período. Ex.: "quando eu larguei o Persona?", "em que jogos eu voltei depois de uma pausa?", "o que eu joguei em março?".',
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
        const timeline = getTimeline(scope, { today: scope.today, year });
        return {
          ...timeline,
          games: timeline.games.map((game) => ({
            gameId: game.gameId,
            igdbId: game.igdbId,
            name: game.name,
            status: game.status,
            statusLabel: gameStatusLabels[game.status],
            minutes: game.minutes,
            spans: game.spans,
            pauses: timelinePauses(game.spans),
            completions: game.completions.map(({ completedOn, type }) => ({
              completedOn,
              type,
              typeLabel: completionTypeLabels[type],
            })),
          })),
        };
      }),
  );

  server.registerTool(
    "get_profile",
    {
      title: "Perfil de gamer",
      description:
        'O "meu gosto" calculado pela biblioteca inteira (sem recorte de período): desenvolvedoras e publishers favoritas (rankings separados; publishers são as creditadas no IGDB, inclusive regionais), séries (collections do IGDB), franquias, gêneros, temas, perspectivas, modos de jogo e plataformas em que joguei. Cada linha traz horas, jogos, zerados, nota média e os jogos mais jogados. criteriaAverages traz a média de cada critério da avaliação guiada (imersão, narrativa, desafio…) com o jogo de maior e menor nota ("o que eu mais valorizo?"). Ex.: "qual minha publisher favorita?", "que série eu mais joguei?", "de que dev eu gosto mais?" (sort: "rating"). Só entram jogos com tempo jogado ou conclusão.',
      inputSchema: z.object({
        sort: profileSortSchema
          .default("minutes")
          .describe(
            `minutes = mais horas; finished = mais zerados; rating = maior nota média (só com ${MIN_RATED_GAMES}+ jogos com nota)`,
          ),
        limit: z.number().int().min(1).max(30).default(5).describe("Linhas por ranking"),
      }),
      annotations: readOnly,
    },
    ({ sort, limit }) =>
      run(() => {
        const profile = getProfile(ctx());
        const top = (section: ProfileSection, label: (name: string) => string = (n) => n) =>
          sortProfileRows(profile[section], sort)
            .slice(0, limit)
            .map((row) => ({
              name: label(row.name),
              hours: Math.round((row.minutes / 60) * 10) / 10,
              games: row.games,
              finished: row.finished,
              avgRating: row.avgRating,
              ratedGames: row.ratedGames,
              topGames: row.topGames.map((g) => g.name),
            }));
        return {
          sort,
          gamesCounted: profile.gamesCounted,
          totalHours: Math.round((profile.totalMinutes / 60) * 10) / 10,
          developers: top("developers"),
          publishers: top("publishers"),
          series: top("series"),
          franchises: top("franchises"),
          genres: top("genres", genreLabel),
          themes: top("themes", themeLabel),
          perspectives: top("perspectives", perspectiveLabel),
          gameModes: top("gameModes", gameModeLabel),
          platforms: top("platforms"),
          /** Média 1–7 de cada critério da avaliação guiada (o que o usuário mais valoriza). */
          criteriaAverages: profile.criteria.map(criterionAverageSummary),
        };
      }),
  );

  server.registerTool(
    "get_rating_template",
    {
      title: "Como avaliar um jogo (critérios)",
      description:
        'Os critérios da avaliação guiada do Zerômetro, com pergunta, o que significa 1 e 7, "por que importa" e um exemplo; os pesos do preset sugerido pelos gêneros do jogo; e a calibragem (as notas que o usuário deu no mesmo critério em jogos recentes). Use antes de rate_game quando o usuário pedir para avaliar conversando ("avalia comigo o Expedition 33"): pergunte UM critério por vez, na ordem, explicando a pergunta e os extremos e citando a calibragem ("no Hades você deu 6"); aceite "não se aplica" (null). No fim, pergunte a nota de coração (0 a 10, passos de 0,5: "no geral, quanto você gostou?") e, se quiser, uma review curta. Critérios com notApplicableByDefault começam como "não se aplica": pergunte só se fizer sentido (ex.: social em jogos multiplayer/coop).',
      inputSchema: z.object({
        game: gameRefSchema
          .optional()
          .describe("Jogo a avaliar (sugere o preset e tira ele da calibragem)"),
      }),
      annotations: readOnly,
    },
    ({ game }) =>
      run(() => {
        const scope = ctx();
        const item = game === undefined ? null : resolveLibraryGame(scope, game);
        const template = getRatingTemplate(scope, item?.gameId);
        const preset = template.suggestedPreset;
        const weights = presetWeights(preset, template.baseWeights);
        const notApplicable = new Set(presetNotApplicable(preset));
        return {
          game: item && { gameId: item.gameId, name: item.name },
          scale: "1 a 7 em cada critério (como o miniPXI); null = não se aplica",
          suggestedPreset: preset,
          presets: ratingPresets
            .filter((p) => p !== "custom")
            .map((p) => ({
              id: p,
              label: presetDefs[p].label,
              description: presetDefs[p].description,
            })),
          mode: template.mode,
          modeLabel: ratingModeLabels[template.mode],
          blendWeight: template.blendWeight,
          minApplicableCriteria: MIN_APPLICABLE_CRITERIA,
          criteria: ratingCriteria.map((c) => ({
            id: c.id,
            group: criterionGroupLabels[c.group],
            label: c.label,
            question: c.question,
            score1: c.low,
            score7: c.high,
            why: c.why,
            example: c.example,
            weight: weights[c.id],
            notApplicableByDefault: notApplicable.has(c.id),
            calibration: template.calibration[c.id].map((e) => `${e.name}: ${e.score}`),
          })),
          enjoyment: "No geral, quanto você gostou? 0 a 10, em passos de 0,5",
          latestRating: ratingSummary(template.latest),
        };
      }),
  );

  server.registerTool(
    "rate_game",
    {
      title: "Avaliar jogo",
      description:
        'Salva uma avaliação guiada: notas 1–7 por critério (ids de get_rating_template; null ou ausente = não se aplica) e a nota de coração (enjoyment, 0–10 em passos de 0,5). Devolve a nota ponderada, a de coração e a final (pelo modo dos ajustes: mistura, só a calculada ou só a de coração), e um aviso se as duas ficarem muito diferentes: nesse caso, comente com o usuário e ofereça revisar algum critério (chamando de novo) ou usar só a de coração (mode: "gut"). Cada chamada cria uma avaliação nova (reavaliar = chamar de novo; a mais recente é a nota do jogo). Para só dar uma nota ("dá 8 pro Hades"), mande só enjoyment com mode "gut". Pergunte os critérios antes (get_rating_template); não invente notas.',
      inputSchema: z.object({
        game: gameRefSchema,
        scores: ratingScoresSchema
          .default({})
          .describe('Ex.: { "controls": 6, "narrative": 7, "social": null }'),
        enjoyment: enjoymentSchema.describe("Nota de coração, 0 a 10 (passos de 0,5)"),
        preset: ratingPresetSchema
          .exclude(["custom"])
          .optional()
          .describe("Pesos por tipo de jogo; padrão: o sugerido pelos gêneros"),
        mode: ratingModeSchema.optional().describe("weighted, gut ou blend; padrão: o dos ajustes"),
        review: ratingReviewSchema.optional().describe("Texto livre do usuário"),
        criterion_notes: criterionNotesSchema.optional().describe("Comentário por critério"),
        completion_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Playthrough avaliado (id da conclusão em get_game)"),
      }),
      annotations: write,
    },
    ({ game, scores, enjoyment, preset, mode, review, criterion_notes, completion_id }) =>
      run(() => {
        const scope = ctx();
        const item = resolveLibraryGame(scope, game);
        const template = getRatingTemplate(scope, item.gameId);
        const { rating, item: updated } = createRating(scope, item.gameId, {
          scores,
          enjoyment,
          preset: preset ?? template.suggestedPreset,
          mode,
          review,
          criterionNotes: criterion_notes,
          completionId: completion_id,
        });
        return {
          rating: ratingSummary(rating),
          game: gameSummary(updated),
          ...(rating.weighted === null &&
            rating.mode !== "gut" && {
              hint: `Com menos de ${MIN_APPLICABLE_CRITERIA} critérios avaliados não há nota calculada: a final é a de coração.`,
            }),
        };
      }),
  );

  server.registerTool(
    "get_rating",
    {
      title: "Avaliação de um jogo",
      description:
        "A avaliação atual (a mais recente) de um jogo, com as notas por critério, os pesos, a ponderada, a de coração, a final e a review, e o histórico de avaliações anteriores (uma por playthrough ou reavaliação).",
      inputSchema: z.object({ game: gameRefSchema }),
      annotations: readOnly,
    },
    ({ game }) =>
      run(() => {
        const scope = ctx();
        const item = resolveLibraryGame(scope, game);
        const [latest, ...previous] = listRatings(scope, item.gameId);
        return {
          game: { gameId: item.gameId, name: item.name },
          latest: ratingSummary(latest ?? null),
          previous: previous.map((r) => ({
            id: r.id,
            final: round1(r.final),
            createdAt: r.createdAt,
            completionId: r.completionId,
          })),
        };
      }),
  );

  server.registerTool(
    "suggest_next",
    {
      title: "O que jogar agora?",
      description:
        'Sugere o que jogar agora entre os jogos em andamento, os próximos e os pausados, pelo tempo disponível e pelo clima, com os motivos ("dá para zerar hoje: faltam ~40min", "você parou em: Palácio 3"). Ex.: "tenho meia hora, o que eu jogo?" (available: "short"), "quero algo leve" (mood: "leve"), "o que jogo com meu amigo?" (mood: "coop", só jogos com coop). Com random: true, sorteia um (as melhores saem mais). Para começar, chame start_session com o jogo escolhido.',
      inputSchema: z.object({
        available: availableTimeSchema
          .optional()
          .describe("short = ~30 min; medium = 1–2h; long = a tarde toda"),
        mood: moodSchema
          .optional()
          .describe("curto, leve, historia, desafio ou coop (coop filtra; os outros pontuam)"),
        platform: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            'Só jogos que rodam nessa plataforma (ex.: "PC", "Switch"); um jogo emulado conta onde é emulado (Switch emulado no PC → "PC")',
          ),
        random: z.boolean().optional().describe("Sorteia 1 entre as 8 melhores"),
      }),
      annotations: readOnly,
    },
    ({ available, mood, platform, random }) =>
      run(() => {
        const scope = ctx();
        const { top, pool } = suggestGames(listLibrary(scope), {
          available,
          mood,
          platform,
          today: scope.today,
        });
        if (random) {
          const picked = pickSuggestion(pool);
          return { picked: picked && suggestionSummary(picked), poolSize: pool.length };
        }
        return { suggestions: top.map(suggestionSummary) };
      }),
  );

  server.registerTool(
    "get_recap",
    {
      title: "Recap da semana ou do mês",
      description:
        "Resumo estilo retrospectiva de uma semana (segunda a domingo) ou de um mês: total jogado comparado ao período anterior (previousMinutes), minutos por dia, top 5 jogos e gêneros, estreias (primeira vez jogando) e retornos (voltou depois de 30+ dias), melhor dia, maior sessão, zerados, conquistas (com a mais rara) e o perfil de horário. Sem data, o último período fechado (semana passada ou mês passado). Com image: true, também devolve a imagem PNG para compartilhar: a geral (stories 9:16 ou paisagem 16:9) ou, com slide, a de um slide do recap (stories).",
      inputSchema: z.object({
        period: z.enum(recapPeriods).describe("week (segunda a domingo) ou month"),
        date: isoDateSchema
          .optional()
          .describe("Qualquer dia do período (YYYY-MM-DD); sem data, o último período fechado"),
        image: z.boolean().optional().describe("Também devolver a imagem PNG do recap"),
        format: z
          .enum(recapImageFormats)
          .optional()
          .describe("Formato da imagem: story (9:16, padrão) ou wide (16:9)"),
        slide: z
          .enum(recapSlideIds)
          .optional()
          .describe(
            "Imagem de um slide só (sempre 9:16): intro, games, genres, discoveries, moments, profile, trophies, summary ou empty. Só os que têm dados no período existem",
          ),
      }),
      annotations: readOnly,
    },
    async ({ period, date, image, format, slide }) => {
      const scope = ctx();
      const recap = getRecap(scope, { today: scope.today, timeZone: scope.timeZone, period, date });
      const result = json({
        ...recap,
        topGenres: recap.topGenres.map((g) => ({ ...g, genre: genreLabel(g.genre) })),
        profile: { ...recap.profile, title: profileTitle(recap.profile) },
      });
      if (!image) return result;
      const slides = recapSlides(recap);
      if (slide && !slides.includes(slide)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `O slide "${slide}" não existe no recap desse período. Slides disponíveis: ${slides.join(", ")}.`,
            },
          ],
        };
      }
      const png = await renderRecapImage(deps.recapImages, recap, {
        format: format ?? "story",
        slide,
      });
      return {
        content: [
          ...result.content,
          {
            type: "image" as const,
            data: Buffer.from(png).toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    },
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
        'Desliga o timer rodando e registra a sessão no dia em que começou ("parei"). Se o usuário esqueceu o timer ligado, passe endTime com o horário local em que parou (HH:MM; se for antes do início, é no dia seguinte). Menos de 1 minuto sem endTime é descartado. Erro se nenhum timer estiver rodando. Se o usuário disser onde parou ("parei, tô no Palácio 3"), passe em note: vira o "onde parei" do jogo.',
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
    "set_session_note",
    {
      title: "Anotar onde parei",
      description:
        'Grava a nota da última sessão encerrada de um jogo, o "onde parei" que aparece no card e na página do jogo ("anota que parei no Palácio 3"). Use depois de stop_session sem nota ou para corrigir a nota. Nota vazia apaga. Erro se o jogo não tem sessão.',
      inputSchema: z.object({
        game: gameRefSchema,
        note: noteSchema.describe('Onde parou, curto (ex.: "Palácio 3, antes do chefe")'),
      }),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, note }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        const { id, playedOn, minutes, note: saved } = noteLastSession(scope, gameId, note);
        return { sessionId: id, playedOn, minutes, note: saved };
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
        "Adiciona um jogo do IGDB à biblioteca. Use search_igdb antes para achar o igdbId (confirme com o usuário se houver várias edições). Status: backlog (próximos), wishlist (desejos), playing (jogando), endless (sem fim: multiplayer, live service, jogos que não se zeram), finished (zerado), paused, dropped. Erro se o jogo já estiver na biblioteca.",
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
        emulatedOn: z
          .string()
          .trim()
          .min(1)
          .max(50)
          .optional()
          .describe(
            'Onde emula, se for emulado (ex.: "PC", "Android", "Steam Deck"); platformPlayed continua sendo o console do jogo',
          ),
        priorMinutes: priorMinutesSchema
          .optional()
          .describe(
            'Minutos já jogados antes de usar o Zerômetro (ex.: "já tenho 39h" → 2340). Veja set_prior_playtime.',
          ),
      }),
      annotations: { ...write, openWorldHint: true },
    },
    ({ igdbId, status, platformPlayed, emulatedOn, priorMinutes }) =>
      run(async () =>
        gameSummary(
          await addToLibrary(ctx(), deps.igdb, {
            igdbId,
            status,
            platformPlayed,
            emulatedOn,
            priorMinutes,
          }),
        ),
      ),
  );

  server.registerTool(
    "set_platform",
    {
      title: "Plataforma e emulação",
      description:
        'Define em que plataforma o usuário joga um jogo da biblioteca e se é emulado ("estou jogando o Zelda emulado no PC", "joguei o Persona no PS5"). platform é o console da versão jogada (Switch, PS5, PC…); emulatedOn é onde roda a emulação (PC, Android, Steam Deck ou outro texto). Campo omitido fica como está; null apaga (emulatedOn null = nativo).',
      inputSchema: z
        .object({
          game: gameRefSchema,
          platform: z.string().trim().min(1).max(50).nullable().optional(),
          emulatedOn: z.string().trim().min(1).max(50).nullable().optional(),
        })
        .refine(
          ({ platform, emulatedOn }) => platform !== undefined || emulatedOn !== undefined,
          "Informe platform e/ou emulatedOn",
        ),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, platform, emulatedOn }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        const { item } = updateLibraryEntry(scope, gameId, {
          ...(platform !== undefined && { platformPlayed: platform }),
          ...(emulatedOn !== undefined && { emulatedOn }),
        });
        return gameSummary(item);
      }),
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
    "set_purchase",
    {
      title: "Compra de um jogo",
      description:
        'Registra quando, onde e por quanto o usuário comprou um jogo da biblioteca ("comprei o Hades na Steam por 47,49 ontem", "peguei o Hi-Fi Rush no Game Pass"). Alimenta o comprei × zerei e o custo por hora (get_period_stats → purchases). Campo omitido fica como está; null apaga. Jogo de assinatura (viaSubscription true) não tem preço: marcar a assinatura apaga o preço, e informar preço num jogo de assinatura é erro. O preço é dado pessoal: não entra no recap.',
      inputSchema: z
        .object({
          game: gameRefSchema,
          acquiredOn: isoDateSchema
            .nullable()
            .optional()
            .describe("Dia da compra ou do resgate (YYYY-MM-DD), nunca no futuro"),
          price: z
            .number()
            .min(0)
            .max(MAX_PRICE_CENTS / 100)
            .nullable()
            .optional()
            .describe("Preço pago em reais (ex.: 47.49; 0 = de graça)"),
          store: z
            .string()
            .trim()
            .min(1)
            .max(50)
            .nullable()
            .optional()
            .describe("Loja ou serviço (Steam, Nuuvem, eShop, PlayStation Store, Game Pass…)"),
          viaSubscription: z
            .boolean()
            .optional()
            .describe("Veio de assinatura (Game Pass, PS Plus…): fica fora do custo por hora"),
        })
        .refine(
          ({ game: _game, ...fields }) => Object.values(fields).some((v) => v !== undefined),
          "Informe pelo menos um campo da compra",
        ),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, acquiredOn, price, store, viaSubscription }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        const { item } = updateLibraryEntry(scope, gameId, {
          ...(acquiredOn !== undefined && { acquiredOn }),
          ...(price !== undefined && {
            pricePaidCents: price === null ? null : reaisToCents(price),
          }),
          ...(store !== undefined && { store }),
          ...(viaSubscription !== undefined && { viaSubscription }),
        });
        return gameSummary(item);
      }),
  );

  server.registerTool(
    "set_status",
    {
      title: "Mudar status",
      description:
        'Muda o status de um jogo da biblioteca ("larguei Y", "vou jogar Z depois", "terminei e parei de jogar X"). playing e endless (sem fim: multiplayer, live service, que não se zera nem está pausado ou abandonado) preenchem a data de início se vazia; finished preenche a data de término (hoje, ou finishedAt) e, se o jogo não tiver nenhuma conclusão, registra a da história nessa data; sair de finished não apaga conclusões. Para registrar que zerou (inclusive extras/100% ou continuando a jogar), prefira mark_completed. Datas no formato YYYY-MM-DD, nunca no futuro.',
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

  server.registerTool(
    "set_progress_goal",
    {
      title: "Meta da barra de progresso",
      description:
        'Define até onde a barra de progresso de um jogo mede ("quero fazer o 100% do Hollow Knight", "minha meta no Tarkov é 500h", "esconde a barra do Fortnite"). goal: achievements = conquistas desbloqueadas das listas Steam/RA que o jogo segue (padrão quando segue alguma), main = história (padrão sem conquistas), extras = história + extras, full = 100% (essas pelo tempo do IGDB, e a barra só enche ao marcar a conclusão com mark_completed), hours = alvo em horas do usuário (passe hours), none = sem barra (padrão do status endless sem conquistas), default = volta para a meta padrão. A meta nunca muda sozinha.',
      inputSchema: z.object({
        game: gameRefSchema,
        goal: z.enum([...progressGoals, "default"]),
        hours: z
          .number()
          .positive()
          .max(MAX_GOAL_MINUTES / 60)
          .optional()
          .describe('Alvo em horas, com goal "hours" (ex.: 500)'),
      }),
      annotations: { ...write, idempotentHint: true },
    },
    ({ game, goal, hours: goalHours }) =>
      run(() => {
        const scope = ctx();
        const { gameId } = resolveLibraryGame(scope, game);
        if (goalHours !== undefined && goal !== "hours") {
          throw new ValidationError('hours só vale com goal "hours"');
        }
        const { item } = updateLibraryEntry(scope, gameId, {
          progressGoal: goal === "default" ? null : goal,
          ...(goalHours !== undefined && { progressGoalMinutes: Math.round(goalHours * 60) }),
        });
        return gameSummary(item);
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
        "Traz da conta Steam do usuário (o perfil conectado nos Ajustes do site) as conquistas desbloqueadas, com a data real, e o tempo total de cada jogo. Com game: só esse jogo, na hora. Sem game: todos os da biblioteca que estão na conta, em segundo plano no servidor (um jogo de cada vez, no ritmo da Steam): a tool espera até 20s e, se ainda não acabou, devolve status running com o andamento (done/total); chame de novo com progress: true para ver o andamento ou o resultado, sem começar outra rodada. Se a Steam pedir uma pausa por excesso de consultas, a rodada para e a mensagem diz a partir de que horas tentar de novo. Só adiciona desbloqueios, nunca desmarca. Um jogo na conta sem lista de conquistas ganha a da Steam. O tempo da Steam fica guardado à parte (steamPlaytime): só vira o tempo jogado se o jogo usar a Steam como fonte (set_playtime_source), e aí o que foi jogado na Steam desde a última sincronização vira sessão (source steam, sessionMinutes; sincronizações seguidas com o jogo aberto estendem a mesma sessão, com startedAt/endedAt aproximados), que entra na ofensiva e nas estatísticas, descontado o que o timer ou log_session já registraram. O total da primeira sincronização (ou da importação) não tem data e fica como tempo antes do Zerômetro. O servidor também sincroniza sozinho de meia em meia hora. Se o perfil não estiver conectado ou esconder os jogos, a mensagem de erro diz o que o usuário precisa fazer.",
      inputSchema: z.object({
        game: gameRefSchema.optional().describe("Um jogo só; omita para sincronizar todos"),
        progress: z
          .boolean()
          .default(false)
          .describe("Só ver o andamento ou o resultado do último 'todos', sem começar outro"),
      }),
      annotations: { ...write, openWorldHint: true },
    },
    ({ game, progress }) =>
      run(async () => {
        const scope = ctx();
        if (game !== undefined) {
          const { gameId } = resolveLibraryGame(scope, game);
          const sync = await syncSteamGame(scope, steamDeps(), gameId);
          return { sync, game: gameSummary(getLibraryItem(scope, gameId)) };
        }
        if (progress) {
          const last = getSteamLibrarySyncRun(scope);
          return last
            ? librarySyncRunSummary(last)
            : { status: null, message: "Nenhuma sincronização de todos os jogos desde o boot." };
        }
        startSteamLibrarySync(scope, steamDeps());
        return librarySyncRunSummary((await waitForSteamLibrarySync(scope, SYNC_WAIT_MS))!);
      }),
  );

  server.registerTool(
    "list_steam_import",
    {
      title: "Jogos da Steam fora da biblioteca",
      description:
        "Lista os jogos da conta Steam do usuário que ainda não estão na biblioteca (mais jogados primeiro), com o appId, as horas na Steam, as horas nas últimas 2 semanas e o status sugerido (jogou nas últimas 2 semanas ou há até 30 dias → playing; senão, backlog). Os que o usuário ignorou numa importação anterior ficam de fora, a menos que include_ignored. Também diz quantos já estão na biblioteca e quais apps o IGDB não conhece (esses não dá para importar; se forem jogos, use search_igdb + add_game). Para importar, use import_steam_games com os appIds.",
      inputSchema: z.object({
        query: z.string().trim().max(100).optional().describe("Filtra pelo nome"),
        include_ignored: z.boolean().default(false).describe("Incluir os ignorados"),
      }),
      annotations: { ...readOnly, openWorldHint: true },
    },
    ({ query, include_ignored: includeIgnored }) =>
      run(async () => {
        const preview = await previewSteamImport(ctx(), steamDeps());
        const term = query?.toLowerCase();
        const matches = (name: string | null) => !term || (name ?? "").toLowerCase().includes(term);
        return {
          inLibrary: preview.inLibrary,
          hidesPlaytime: preview.hidesPlaytime,
          ignored: preview.candidates.filter((c) => c.ignored).length,
          games: preview.candidates
            .filter(
              (c) => (includeIgnored || !c.ignored) && (matches(c.name) || matches(c.steamName)),
            )
            .map((c) =>
              Object.assign(
                {
                  appId: c.appId,
                  name: c.name,
                  hours: hours(c.minutes * 60),
                  suggestedStatus: c.suggestedStatus,
                },
                c.steamName && { steamName: c.steamName },
                c.recentMinutes > 0 && { recentHours: hours(c.recentMinutes * 60) },
                c.ignored && { ignored: true },
              ),
            ),
          notInIgdb: preview.unmatched.filter((u) => matches(u.name)).map((u) => u.name ?? u.appId),
        };
      }),
  );

  server.registerTool(
    "import_steam_games",
    {
      title: "Importar jogos da Steam",
      description:
        "Põe na biblioteca jogos da conta Steam do usuário (os appIds vêm de list_steam_import). Eles entram com o tempo da Steam como tempo jogado (playtimeSource steam) e com as conquistas já sincronizadas (pode levar alguns segundos por jogo). Sem status, vale o sugerido. ignore guarda appIds que o usuário não quer (somem de list_steam_import). Os que já estão na biblioteca, saíram da conta ou o IGDB não conhece voltam em skipped, com o motivo.",
      inputSchema: z.object({
        games: z
          .array(
            z.object({
              app_id: z.number().int().positive(),
              status: gameStatusSchema.optional().describe("Omita para usar o sugerido"),
            }),
          )
          .max(200)
          .describe("Os jogos que entram"),
        ignore: z.array(z.number().int().positive()).max(2000).optional(),
      }),
      annotations: { ...write, openWorldHint: true },
    },
    ({ games, ignore }) =>
      run(async () => {
        const scope = ctx();
        const result = await importSteamGames(scope, steamDeps(), {
          games: games.map((g) => ({ appId: g.app_id, ...(g.status && { status: g.status }) })),
          ignore,
        });
        const gameIds = result.added.map((a) => a.gameId);
        // As conquistas em segundo plano (centenas de jogos levam minutos no ritmo da Steam).
        let achievementsRun: SteamLibrarySyncRun | null = null;
        if (gameIds.length > 0) {
          startSteamLibrarySync(scope, steamDeps(), { gameIds });
          achievementsRun = await waitForSteamLibrarySync(scope, SYNC_WAIT_MS);
        }
        const sync = achievementsRun?.status === "done" ? achievementsRun.result : null;
        const byGame = new Map(sync?.games.map((g) => [g.gameId, g]));
        return {
          added: result.added.map(({ gameId, name, status }) => {
            const synced = byGame.get(gameId);
            return Object.assign(
              {
                gameId,
                name,
                status,
                steamMinutes: synced?.steamMinutes ?? null,
                newUnlocks: synced?.newUnlocks ?? 0,
              },
              synced?.error && { error: synced.error },
            );
          }),
          skipped: result.skipped,
          ignored: result.ignored,
          ...(achievementsRun &&
            achievementsRun.status !== "done" && {
              achievements: {
                status: achievementsRun.status,
                done: achievementsRun.done,
                total: achievementsRun.total,
                ...(achievementsRun.error
                  ? { error: achievementsRun.error }
                  : {
                      message:
                        "As conquistas continuam chegando em segundo plano. Chame sync_steam com progress: true para acompanhar.",
                    }),
              },
            }),
        };
      }),
  );

  server.registerTool(
    "set_playtime_source",
    {
      title: "Fonte do tempo jogado",
      description:
        'Escolhe de onde vem o tempo jogado de um jogo: "sessions" (controle manual: sessões registradas + tempo antes do Zerômetro) ou "steam" (o total da Steam, da última sync_steam; o jogado na Steam daí em diante vira sessão e entra na ofensiva e nas estatísticas). As sessões continuam contando na ofensiva e nas estatísticas nos dois casos. Para usar "steam", sincronize o jogo antes.',
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

  server.registerTool(
    "get_group_leaderboard",
    {
      title: "Ranking do grupo",
      description:
        'O ranking entre os amigos desta instância (quem deixou "Aparecer no grupo" ligado) num período: horas jogadas (pelas sessões; em "all", o total da biblioteca), dias jogados, jogos zerados pela primeira vez, 100%, conquistas desbloqueadas (e a mais rara), ofensiva atual, o mais jogado e o que está jogando agora. Ex.: "quem jogou mais esse mês?", "quem zerou mais esse ano?", "quem pegou mais conquistas na semana?". isMe marca o usuário. meHidden: o usuário saiu do ranking.',
      inputSchema: z.object({
        period: z
          .enum(groupPeriods)
          .default("month")
          .describe(
            "week = semana atual (desde segunda); month = mês atual; year = ano atual; all = sempre",
          ),
        sortBy: z
          .enum(groupMetrics)
          .default("minutes")
          .describe(
            "minutes = horas; finished = zerados; achievements = conquistas; streak = ofensiva",
          ),
      }),
      annotations: readOnly,
    },
    ({ period, sortBy }) =>
      run(() => {
        const board = getLeaderboard(ctx(), period);
        return {
          period,
          from: board.from,
          to: board.to,
          meHidden: board.meHidden,
          ranking: board.members
            .toSorted((a, b) => b[sortBy] - a[sortBy])
            .map((m, i) => ({
              position: i + 1,
              name: m.name,
              handle: m.handle,
              isMe: m.isMe,
              hours: minutesToHours(m.minutes),
              playedDays: m.playedDays,
              finished: m.finished,
              fullCompletions: m.fullCompletions,
              achievements: m.achievements,
              rarestAchievement: m.rarestAchievement
                ? `${m.rarestAchievement.title} (${m.rarestAchievement.name}, ${m.rarestAchievement.rarity}% dos jogadores)`
                : null,
              streakDays: m.streak,
              topGame: m.topGame?.name ?? null,
              playingNow: m.playingNow?.name ?? null,
            })),
        };
      }),
  );

  server.registerTool(
    "get_friend_profile",
    {
      title: "Perfil de um amigo",
      description:
        'O perfil público de alguém do grupo, pelo @apelido (veja get_group_leaderboard): o que está jogando, as últimas conclusões, a nota de cada jogo, os totais (horas, zerados, 100%, conquistas, ofensiva) e os gêneros, séries e desenvolvedoras favoritos. Cada um escolhe o que compartilha: o que vier null a pessoa não mostra ao grupo (sharedSections lista o que ela mostra). Ex.: "o que a @ana anda jogando?", "o que o joao zerou por último?".',
      inputSchema: z.object({
        handle: z.string().trim().min(1).describe("@apelido do amigo (com ou sem @)"),
      }),
      annotations: readOnly,
    },
    ({ handle }) =>
      run(() => {
        const friend = handle.replace(/^@/, "").toLowerCase();
        const profile = getMemberProfile(ctx(), friend);
        const gamer = getMemberGamerProfile(ctx(), friend);
        const totals = (t: NonNullable<typeof profile.totals>) => {
          const { minutes, ...rest } = t;
          return { ...rest, hours: minutesToHours(minutes) };
        };
        return {
          name: profile.member.name,
          handle: profile.member.handle,
          playingNow: profile.playingNow?.name ?? null,
          sharedSections: profile.sections,
          totals: profile.totals && totals(profile.totals),
          playing: profile.playing?.map(friendGame) ?? null,
          recentlyFinished:
            profile.recentlyFinished?.map((g) => ({
              ...friendGame(g),
              type: g.type,
              completedOn: g.completedOn,
            })) ?? null,
          ratings: profile.ratings?.map((g) => ({ name: g.name, rating: g.rating })) ?? null,
          genres: friendRows(gamer.genres, genreLabel),
          series: friendRows(gamer.series),
          developers: friendRows(gamer.developers),
        };
      }),
  );

  return server;
}

/** Um jogo de um amigo para o modelo. */
const friendGame = (g: GroupMemberGame) => ({
  name: g.name,
  status: g.status,
  hours: minutesToHours(g.minutesPlayed),
  completion: g.completion?.best ?? null,
  rating: g.rating,
});

/** Os 5 primeiros de um ranking de um amigo; null = a pessoa não compartilha. */
const friendRows = (list: ProfileRow[] | null, label: (name: string) => string = (n) => n) =>
  list?.slice(0, 5).map((row) => ({
    name: label(row.name),
    hours: minutesToHours(row.minutes),
    games: row.games,
  })) ?? null;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Avaliação para o modelo: notas por critério com o nome, e as três notas em 1 casa. */
function ratingSummary(rating: RatingItem | null) {
  if (!rating) return null;
  return {
    id: rating.id,
    final: round1(rating.final),
    weighted: rating.weighted === null ? null : round1(rating.weighted),
    enjoyment: rating.enjoyment,
    mode: rating.mode,
    modeLabel: ratingModeLabels[rating.mode],
    preset: rating.preset,
    presetLabel: presetDefs[rating.preset].label,
    applicableCount: rating.applicableCount,
    scores: Object.fromEntries(
      ratingCriteria.map((c) => [c.id, { label: c.label, score: rating.scores[c.id] ?? null }]),
    ),
    weights: rating.weights,
    criterionNotes: rating.criterionNotes,
    review: rating.review,
    completionId: rating.completionId,
    createdAt: rating.createdAt,
    ...(rating.divergent && { warning: DIVERGENCE_MESSAGE }),
  };
}

function criterionAverageSummary(a: CriterionAverage) {
  return {
    criterion: a.criterion,
    label: criteriaById[a.criterion].label,
    average: round1(a.average),
    games: a.count,
    best: a.best && `${a.best.name}: ${a.best.score}`,
    worst: a.worst && `${a.worst.name}: ${a.worst.score}`,
  };
}

/** Quanto a sync_steam (todos) espera a rodada em segundo plano antes de responder. */
const SYNC_WAIT_MS = 20_000;

/** O "Sincronizar tudo" para a IA: o andamento, o erro ou só os jogos que têm o que contar. */
function librarySyncRunSummary(syncRun: SteamLibrarySyncRun) {
  if (syncRun.status === "running") {
    return {
      status: syncRun.status,
      done: syncRun.done,
      total: syncRun.total,
      message:
        "Continua em segundo plano. Chame sync_steam com progress: true para ver o andamento e o resultado.",
    };
  }
  if (syncRun.status === "failed" || !syncRun.result) {
    return {
      status: syncRun.status,
      done: syncRun.done,
      total: syncRun.total,
      error: syncRun.error,
    };
  }
  const result = syncRun.result;
  return {
    status: syncRun.status,
    syncedAt: result.syncedAt,
    newUnlocks: result.newUnlocks,
    games: result.games
      .filter((g) => g.owned || g.newUnlocks > 0 || g.error)
      .map(({ gameId, name, steamMinutes, newUnlocks, sessionMinutes, linkedSet, error }) =>
        Object.assign(
          { gameId, name, steamMinutes, newUnlocks },
          sessionMinutes > 0 && { sessionMinutes },
          linkedSet && { linkedSet },
          error && { error },
        ),
      ),
  };
}

/** Minutos em horas, com uma casa. */
const minutesToHours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

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
