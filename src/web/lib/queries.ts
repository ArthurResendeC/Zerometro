import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AchievementCandidatesQuery,
  AchievementItem,
  AchievementSetItem,
  AchievementsSummary,
  GameAchievements,
  LinkAchievementSetInput,
} from "@shared/achievements";
import type { MarkCompletedInput } from "@shared/completions";
import type {
  AddObjectiveInput,
  ObjectiveItem,
  ObjectiveWriteResult,
  UpdateObjectiveInput,
} from "@shared/objectives";
import { completionTypeLabels, type GameStatus, gameStatusLabels } from "@shared/domain";
import type {
  AddToLibraryInput,
  LibraryItem,
  LibraryListQuery,
  UpdateLibraryEntryInput,
} from "@shared/library";
import type {
  ListSessionsQuery,
  LogSessionInput,
  LogSessionResult,
  UpdateSessionInput,
} from "@shared/sessions";
import type { UpdateSettingsInput } from "@shared/settings";
import {
  type LinkSteamProfileInput,
  STEAM_SYNC_GAMES_BATCH,
  type SteamAutoSyncState,
  type SteamImportInput,
} from "@shared/steam";
import type {
  StartTimerInput,
  StartTimerResult,
  StopTimerInput,
  StopTimerResult,
} from "@shared/timer";
import type { UpdateLibraryEntryResult } from "@shared/library";
import { DEFAULT_TIME_ZONE, nextOccurrence, todayIn, zonedParts } from "@shared/dates";
import { reachedStreakMilestone } from "@/features/audio/sound-events";
import type { SoundName } from "@/features/audio/sounds";
import { useSound } from "@/features/audio/use-sound";
import {
  autoSyncMessage,
  gameSyncMessage,
  librarySyncMessage,
  importMessage,
} from "@/features/steam/sync-messages";
import {
  currentTimer,
  currentUserId,
  discardQueued,
  enqueue,
  findGame,
  gameOf,
  isConnectionError,
  isOffline,
  mustQueue,
  newClientId,
  requestOptions,
  serverNow,
} from "@/features/offline/actions";
import { ApiError, api, unwrap } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";

// Query keys e queryOptions centralizados: rotas usam no loader e componentes no useQuery.

export const libraryKeys = {
  all: ["library"] as const,
  list: (filters: LibraryListQuery) => [...libraryKeys.all, "list", filters] as const,
  item: (gameId: number) => [...libraryKeys.all, "item", gameId] as const,
  byIgdb: (igdbId: number) => [...libraryKeys.all, "igdb", igdbId] as const,
};

export const libraryListQuery = (filters: LibraryListQuery = {}) =>
  queryOptions({
    queryKey: libraryKeys.list(filters),
    queryFn: () =>
      unwrap(
        api.library.$get({
          query: {
            ...(filters.status && { status: filters.status }),
            ...(filters.displayState && { displayState: filters.displayState }),
            ...(filters.q && { q: filters.q }),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

export const libraryItemQuery = (gameId: number) =>
  queryOptions({
    queryKey: libraryKeys.item(gameId),
    queryFn: async () =>
      (await unwrap(api.library[":gameId"].$get({ param: { gameId: String(gameId) } }))).item,
  });

/** O jogo na biblioteca pelo id do IGDB; null se não estiver nela. */
export const libraryByIgdbQuery = (igdbId: number) =>
  queryOptions({
    queryKey: libraryKeys.byIgdb(igdbId),
    queryFn: async () =>
      (await unwrap(api.library.igdb[":igdbId"].$get({ param: { igdbId: String(igdbId) } }))).item,
  });

/** Dados do IGDB para a aba "Sobre" (o servidor guarda por 1 dia). */
export const gamePageQuery = (igdbId: number) =>
  queryOptions({
    queryKey: ["igdb", "game", igdbId],
    queryFn: async () =>
      (await unwrap(api.igdb.games[":igdbId"].$get({ param: { igdbId: String(igdbId) } }))).game,
    staleTime: 60 * 60_000,
    // 404 (jogo inexistente) e 503 (IGDB não configurado) não melhoram tentando de novo.
    retry: (failures, error) =>
      !(error instanceof ApiError && (error.status === 404 || error.status === 503)) &&
      failures < 2,
  });

export const igdbSearchQuery = (q: string) =>
  queryOptions({
    queryKey: ["igdb", "search", q],
    queryFn: async () => (await unwrap(api.igdb.search.$get({ query: { q } }))).results,
    enabled: q.trim().length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

export const feedsQuery = () =>
  queryOptions({
    queryKey: ["feeds"],
    queryFn: async () => (await unwrap(api.feeds.$get())).feeds,
    // O servidor atualiza as listas 1x por dia.
    staleTime: 60 * 60_000,
  });

function onError(error: Error) {
  toast.error(error.message);
}

export function useAddToLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddToLibraryInput) =>
      (await unwrap(api.library.$post({ json: input }))).item,
    onSuccess: (item) => {
      toast.success(`${item.name} adicionado em ${gameStatusLabels[item.status]}`);
      setLibraryItem(queryClient, item);
      return queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
    onError,
  });
}

/** O item aparece por duas chaves: pelo id interno e pelo id do IGDB (página do jogo). */
function setLibraryItem(queryClient: ReturnType<typeof useQueryClient>, item: LibraryItem) {
  queryClient.setQueryData(libraryKeys.item(item.gameId), item);
  queryClient.setQueryData(libraryKeys.byIgdb(item.igdbId), item);
}

function patchLibraryEntry(gameId: number, patch: UpdateLibraryEntryInput) {
  return unwrap(api.library[":gameId"].$patch({ param: { gameId: String(gameId) }, json: patch }));
}

/** Sons de uma mudança na biblioteca, pelo que o servidor confirmou. */
function libraryChangeSounds({ item, previousStatus }: UpdateLibraryEntryResult): SoundName[] {
  const finishedNow = item.status === "finished" && previousStatus !== "finished";
  // TODO(audio): metas anuais ainda não existem. Quando existirem, a API deve devolver os zerados
  // do ano antes/depois e a meta; se passou de abaixo para igual ou acima dela → "goal-reached".
  return finishedNow ? ["game-finished"] : [];
}

/** Formulário da página do jogo (select de status, nota, datas...). */
export function useUpdateLibraryEntry(gameId: number) {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  return useMutation({
    mutationFn: (patch: UpdateLibraryEntryInput) => patchLibraryEntry(gameId, patch),
    onSuccess: (result) => {
      playMostImportant(libraryChangeSounds(result));
      setLibraryItem(queryClient, result.item);
      return queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
    onError,
  });
}

/**
 * Muda o status de qualquer jogo (um hook para vários jogos), para o kanban da biblioteca.
 * TODO(audio): o kanban (drag-and-drop com dnd-kit) ainda não existe; ao soltar um card numa
 * coluna, chame `mutate({ gameId, status })`. O som de "zerado" já sai daqui.
 */
export function useMoveGameStatus() {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  return useMutation({
    mutationFn: ({ gameId, status }: { gameId: number; status: GameStatus }) =>
      patchLibraryEntry(gameId, { status }),
    onSuccess: (result) => {
      playMostImportant(libraryChangeSounds(result));
      setLibraryItem(queryClient, result.item);
      return queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
    onError,
  });
}

export function useRemoveFromLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (gameId: number) =>
      (await unwrap(api.library[":gameId"].$delete({ param: { gameId: String(gameId) } }))).removed,
    onSuccess: (removed) => {
      toast.success(`${removed.name} removido da biblioteca`);
      queryClient.removeQueries({ queryKey: libraryKeys.item(removed.gameId) });
      // A página do jogo continua aberta, agora como "fora da biblioteca".
      queryClient.setQueriesData<LibraryItem | null>(
        { queryKey: [...libraryKeys.all, "igdb"] },
        (old) => (old?.gameId === removed.gameId ? null : old),
      );
      return invalidateGameData(queryClient);
    },
    onError,
  });
}

// ---------------------------------------------------------------------------
// Sessões

export const sessionKeys = {
  all: ["sessions"] as const,
  list: (filters: ListSessionsQuery) => [...sessionKeys.all, "list", filters] as const,
};

export const sessionsQuery = (filters: ListSessionsQuery = {}) =>
  queryOptions({
    queryKey: sessionKeys.list(filters),
    queryFn: async () =>
      (
        await unwrap(
          api.sessions.$get({
            query: {
              ...(filters.gameId && { gameId: String(filters.gameId) }),
              ...(filters.from && { from: filters.from }),
              ...(filters.to && { to: filters.to }),
              ...(filters.limit && { limit: String(filters.limit) }),
            },
          }),
        )
      ).sessions,
  });

/** Sons de uma sessão gravada (timer parado ou registro manual). */
function sessionSavedSounds(result: LogSessionResult): SoundName[] {
  return [
    "session-stop",
    ...(reachedStreakMilestone(result.streak) ? ["streak-milestone" as const] : []),
  ];
}

function toastSessionSaved(result: LogSessionResult) {
  const { session, dayTotalMinutes, statusChangedTo } = result;
  toast.success(`${formatMinutes(session.minutes)} de ${session.gameName} registrados`, {
    description: [
      `Total do dia: ${formatMinutes(dayTotalMinutes)}`,
      statusChangedTo && `Agora em ${gameStatusLabels[statusChangedTo]}`,
    ]
      .filter(Boolean)
      .join(" · "),
  });
}

/** Sessões mudam totais da biblioteca, as estatísticas e o timer. */
function invalidateGameData(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: timerKeys.all }),
    queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
    queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
    queryClient.invalidateQueries({ queryKey: statsKeys.all }),
  ]);
}

/** Resultado de uma escrita que pode ter ido para a fila offline em vez do servidor. */
type Outcome<T> = { queued: false; result: T } | { queued: true; offline: boolean };

const queued = (): { queued: true; offline: boolean } => ({ queued: true, offline: isOffline() });

/** Avisa que ficou guardado no aparelho (online com fila, quem avisa é a sincronização). */
function toastQueued(outcome: { offline: boolean }, title: string) {
  if (outcome.offline) {
    toast.success(title, { description: "Sem conexão: vai para o servidor quando ela voltar." });
  }
}

/**
 * Registrar sessão. Sem conexão (ou com algo do usuário ainda na fila), vai para a fila offline
 * com um `clientId`; se a requisição falhar por conexão, também. O mesmo `clientId` vai nas duas
 * tentativas, então o servidor nunca grava duas vezes.
 */
export function useLogSession() {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  return useMutation({
    networkMode: "always",
    mutationFn: async (input: LogSessionInput): Promise<Outcome<LogSessionResult>> => {
      const userId = currentUserId(queryClient);
      // O dia vai sempre explícito: sincronizada amanhã, a sessão continua sendo de hoje.
      const json = { ...input, playedOn: input.playedOn ?? todayIn(), clientId: newClientId() };
      const queue = (owner: string) => {
        enqueue(
          owner,
          { kind: "log", game: findGame(queryClient, input.gameId), input: json },
          {
            id: json.clientId,
          },
        );
        return queued();
      };
      if (userId && mustQueue(userId)) return queue(userId);
      try {
        const result = await unwrap(api.sessions.$post({ json }, requestOptions()));
        return { queued: false, result };
      } catch (error) {
        if (userId && isConnectionError(error)) return queue(userId);
        throw error;
      }
    },
    onSuccess: (outcome, input) => {
      if (outcome.queued) {
        playMostImportant(["session-stop"]);
        const game = findGame(queryClient, input.gameId);
        toastQueued(
          outcome,
          `${formatMinutes(input.minutes)} de ${game.name} guardados no aparelho`,
        );
        return;
      }
      playMostImportant(sessionSavedSounds(outcome.result));
      toastSessionSaved(outcome.result);
      return invalidateGameData(queryClient);
    },
    onError,
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: UpdateSessionInput }) =>
      (await unwrap(api.sessions[":id"].$patch({ param: { id: String(id) }, json: patch })))
        .session,
    onSuccess: () => {
      toast.success("Sessão atualizada");
      return invalidateGameData(queryClient);
    },
    onError,
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await unwrap(api.sessions[":id"].$delete({ param: { id: String(id) } }))).deleted,
    onSuccess: (deleted) => {
      toast.success(`Sessão de ${formatMinutes(deleted.minutes)} apagada`);
      return invalidateGameData(queryClient);
    },
    onError,
  });
}

// ---------------------------------------------------------------------------
// Estatísticas e ajustes

export const statsKeys = { all: ["stats"] as const };

// ---------------------------------------------------------------------------
// Conclusões (zerei a história, + extras, 100%)

export const completionKeys = {
  all: ["completions"] as const,
  list: (gameId: number) => [...completionKeys.all, gameId] as const,
};

export const completionsQuery = (gameId: number) =>
  queryOptions({
    queryKey: completionKeys.list(gameId),
    queryFn: async () =>
      (await unwrap(api.library[":gameId"].completions.$get({ param: { gameId: String(gameId) } })))
        .completions,
  });

/** Conclusões mudam o item (selo, pós-jogo, progresso), a lista e os zerados das estatísticas. */
function invalidateCompletions(queryClient: ReturnType<typeof useQueryClient>, gameId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
    queryClient.invalidateQueries({ queryKey: completionKeys.list(gameId) }),
    queryClient.invalidateQueries({ queryKey: statsKeys.all }),
  ]);
}

export function useMarkCompleted(gameId: number) {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  return useMutation({
    mutationFn: (input: MarkCompletedInput) =>
      unwrap(
        api.library[":gameId"].completions.$post({
          param: { gameId: String(gameId) },
          json: input,
        }),
      ),
    onSuccess: ({ completion, item, previousStatus }) => {
      playMostImportant(["game-finished"]);
      const where =
        item.status !== previousStatus
          ? `movido para ${gameStatusLabels[item.status]}`
          : item.displayState === "postgame"
            ? "segue em Jogando (pós-jogo)"
            : null;
      toast.success(`${item.name}: ${completionTypeLabels[completion.type]} registrada`, {
        description: where ?? undefined,
      });
      setLibraryItem(queryClient, item);
      return invalidateCompletions(queryClient, gameId);
    },
    onError,
  });
}

export function useRemoveCompletion(gameId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.completions[":id"].$delete({ param: { id: String(id) } })),
    onSuccess: ({ item }) => {
      toast.success("Conclusão apagada");
      setLibraryItem(queryClient, item);
      return invalidateCompletions(queryClient, gameId);
    },
    onError,
  });
}
export const settingsKeys = { all: ["settings"] as const };

export const statsQuery = () =>
  queryOptions({
    queryKey: statsKeys.all,
    queryFn: () => unwrap(api.stats.$get()),
  });

/** Sem ano: os últimos 12 meses. Fica sob statsKeys.all, então é invalidado junto com as stats. */
export const heatmapQuery = (year?: number) =>
  queryOptions({
    queryKey: [...statsKeys.all, "heatmap", year ?? "rolling"],
    queryFn: () => unwrap(api.stats.heatmap.$get({ query: year ? { year: String(year) } : {} })),
    placeholderData: keepPreviousData,
  });

export const breakdownQuery = (year?: number) =>
  queryOptions({
    queryKey: [...statsKeys.all, "breakdown", year ?? "rolling"],
    queryFn: () => unwrap(api.stats.breakdown.$get({ query: year ? { year: String(year) } : {} })),
    placeholderData: keepPreviousData,
  });

export const rhythmQuery = (year?: number) =>
  queryOptions({
    queryKey: [...statsKeys.all, "rhythm", year ?? "rolling"],
    queryFn: () => unwrap(api.stats.rhythm.$get({ query: year ? { year: String(year) } : {} })),
    placeholderData: keepPreviousData,
  });

export const recordsQuery = (year?: number) =>
  queryOptions({
    queryKey: [...statsKeys.all, "records", year ?? "rolling"],
    queryFn: () => unwrap(api.stats.records.$get({ query: year ? { year: String(year) } : {} })),
    placeholderData: keepPreviousData,
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: settingsKeys.all,
    queryFn: async () => (await unwrap(api.settings.$get())).settings,
  });

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateSettingsInput) =>
      (await unwrap(api.settings.$patch({ json: patch }))).settings,
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.all, settings);
      toast.success("Ajustes salvos");
      return queryClient.invalidateQueries({ queryKey: statsKeys.all });
    },
    onError,
  });
}

// ---------------------------------------------------------------------------
// Timer (o estado vive no servidor; aqui só o cache dele)

export const timerKeys = { all: ["timer"] as const };

export const timerQuery = () =>
  queryOptions({
    queryKey: timerKeys.all,
    queryFn: async () => {
      const state = await unwrap(api.timer.$get());
      // Diferença entre o relógio do servidor e o do aparelho, para o cronômetro não mentir.
      return { ...state, clockOffsetMs: Date.parse(state.now) - Date.now() };
    },
    // Pega timers iniciados em outro aparelho (além do refetch ao focar a janela).
    refetchInterval: 60_000,
  });

/** Como `TimerActiveError` do servidor, para o "Trocar de jogo" funcionar igual offline. */
function timerActiveError(gameName: string, startedAt: string) {
  const since = zonedParts(new Date(startedAt), DEFAULT_TIME_ZONE).time;
  return new ApiError(409, "timer_active", `Você já está jogando ${gameName} desde ${since}`);
}

const noTimerError = () => new ApiError(404, "not_found", "Nenhum timer rodando");

type StartOutcome =
  | Outcome<StartTimerResult>
  | { queued: true; offline: boolean; alreadyRunning: boolean; gameName: string };

export function useStartTimer() {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: async (input: StartTimerInput): Promise<StartOutcome> => {
      const userId = currentUserId(queryClient);
      const clientId = newClientId();
      const clickedAt = serverNow(queryClient);
      const queue = (owner: string): StartOutcome => {
        const current = currentTimer(queryClient);
        const game = findGame(queryClient, input.gameId);
        if (current?.gameId === input.gameId) {
          return { ...queued(), alreadyRunning: true, gameName: game.name };
        }
        if (current && !input.replaceActive)
          throw timerActiveError(current.gameName, current.startedAt);
        enqueue(
          owner,
          {
            kind: "timer.start",
            game,
            input: {
              gameId: input.gameId,
              startedAt: clickedAt.toISOString(),
              clientId,
              replaceActive: true,
            },
          },
          { id: clientId },
        );
        return { ...queued(), alreadyRunning: false, gameName: game.name };
      };
      if (userId && mustQueue(userId)) return queue(userId);
      try {
        const result = await unwrap(
          api.timer.start.$post({ json: { ...input, clientId } }, requestOptions()),
        );
        return { queued: false, result };
      } catch (error) {
        if (userId && isConnectionError(error)) return queue(userId);
        throw error;
      }
    },
    onSuccess: (outcome) => {
      if (outcome.queued) {
        if ("alreadyRunning" in outcome && !outcome.alreadyRunning) {
          playMostImportant(["session-start"]);
          toastQueued(outcome, `Valendo! Bom jogo de ${outcome.gameName}`);
        }
        return;
      }
      const { result } = outcome;
      if (result.stopped) toastStopped(result.stopped);
      if (!result.alreadyRunning) {
        // Trocar de jogo encerra o anterior: se isso bateu um marco da ofensiva, o marco ganha.
        const stopped = result.stopped && !result.stopped.discarded ? result.stopped : null;
        playMostImportant([
          "session-start",
          stopped && reachedStreakMilestone(stopped.streak) && "streak-milestone",
        ]);
        toast.success(`Valendo! Bom jogo de ${result.active.gameName}`, {
          description: result.statusChangedTo
            ? `Agora em ${gameStatusLabels[result.statusChangedTo]}`
            : undefined,
        });
      }
      return invalidateGameData(queryClient);
    },
    onError: (error, input) => {
      // Outro jogo rodando: oferece a troca em vez de só mostrar o erro.
      if (error instanceof ApiError && error.code === "timer_active") {
        toast.warning(error.message, {
          action: {
            label: "Trocar de jogo",
            onClick: () => mutation.mutate({ ...input, replaceActive: true }),
          },
        });
        return;
      }
      onError(error);
    },
  });
  return mutation;
}

function toastStopped(result: StopTimerResult) {
  if (result.discarded) toast.info(`Menos de 1 minuto de ${result.gameName}: sessão descartada`);
  else toastSessionSaved(result);
}

type StopOutcome =
  | Outcome<StopTimerResult>
  | { queued: true; offline: boolean; gameName: string; minutes: number };

export function useStopTimer() {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  return useMutation({
    networkMode: "always",
    mutationFn: async (input: StopTimerInput): Promise<StopOutcome> => {
      const userId = currentUserId(queryClient);
      const current = currentTimer(queryClient);
      const clickedAt = serverNow(queryClient);
      const queue = (owner: string): StopOutcome => {
        if (!current) throw noTimerError();
        const start = new Date(current.startedAt);
        const end = input.endTime
          ? nextOccurrence(start, input.endTime, DEFAULT_TIME_ZONE)
          : clickedAt;
        const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
        if (current.pending && minutes < 1 && current.outboxId) {
          // Nem chegou ao servidor e durou menos de 1 minuto: some da fila (como o descarte de lá).
          discardQueued(current.outboxId);
        } else {
          enqueue(
            owner,
            {
              kind: "timer.stop",
              game: gameOf(current),
              startedAt: current.startedAt,
              input: {
                target: current.target,
                endedAt: end.toISOString(),
                ...(input.note !== undefined && { note: input.note }),
              },
            },
            { dependsOn: current.outboxId },
          );
        }
        return { ...queued(), gameName: current.gameName, minutes };
      };
      if (userId && mustQueue(userId)) return queue(userId);
      try {
        const target = current && !current.pending ? { target: current.target } : {};
        const result = await unwrap(
          api.timer.stop.$post({ json: { ...input, ...target } }, requestOptions()),
        );
        return { queued: false, result };
      } catch (error) {
        if (userId && isConnectionError(error)) return queue(userId);
        throw error;
      }
    },
    onSuccess: (outcome) => {
      if (outcome.queued) {
        playMostImportant(["session-stop"]);
        if (!("gameName" in outcome)) return;
        if (outcome.minutes < 1) {
          toast.info(`Menos de 1 minuto de ${outcome.gameName}: sessão descartada`);
        } else {
          toastQueued(
            outcome,
            `${formatMinutes(outcome.minutes)} de ${outcome.gameName} guardados no aparelho`,
          );
        }
        return;
      }
      const { result } = outcome;
      // Sessão de menos de 1 minuto é descartada, mas o usuário parou o timer: toca o "parei".
      playMostImportant(result.discarded ? ["session-stop"] : sessionSavedSounds(result));
      toastStopped(result);
      return invalidateGameData(queryClient);
    },
    onError,
  });
}

export function useCancelTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: async (): Promise<{ gameName: string; queued: boolean }> => {
      const userId = currentUserId(queryClient);
      const current = currentTimer(queryClient);
      const queue = (owner: string) => {
        if (!current) throw noTimerError();
        // Timer que nem chegou ao servidor: basta tirar o início da fila.
        if (current.pending && current.outboxId) discardQueued(current.outboxId);
        else
          enqueue(owner, { kind: "timer.cancel", game: gameOf(current), target: current.target });
        return { gameName: current.gameName, queued: true };
      };
      if (userId && mustQueue(userId)) return queue(userId);
      try {
        const query = current && !current.pending ? { id: String(current.id) } : {};
        const { cancelled } = await unwrap(api.timer.$delete({ query }, requestOptions()));
        return { gameName: cancelled.gameName, queued: false };
      } catch (error) {
        if (userId && isConnectionError(error)) return queue(userId);
        throw error;
      }
    },
    onSuccess: ({ gameName, queued: wasQueued }) => {
      toast.info(`Timer de ${gameName} descartado`);
      if (!wasQueued) return invalidateGameData(queryClient);
    },
    onError,
  });
}

// ---------------------------------------------------------------------------
// Sessão (login)

export const authKeys = { session: ["auth", "session"] as const };

export const sessionQuery = () =>
  queryOptions({
    queryKey: authKeys.session,
    // Sem rede (ou servidor fora do ar) não é "deslogado": falha e mantém a sessão do cache.
    queryFn: getSession,
    staleTime: 5 * 60_000,
    // Offline sem nada guardado: falha na hora (cai no login) em vez de esperar a rede voltar.
    networkMode: "always",
    retry: false,
  });

// ---------------------------------------------------------------------------
// Objetivos (checkbox e contador)

export const objectiveKeys = {
  all: ["objectives"] as const,
  list: (gameId: number) => [...objectiveKeys.all, gameId] as const,
};

export const objectivesQuery = (gameId: number) =>
  queryOptions({
    queryKey: objectiveKeys.list(gameId),
    queryFn: async () =>
      (await unwrap(api.library[":gameId"].objectives.$get({ param: { gameId: String(gameId) } })))
        .objectives,
  });

export type ObjectiveChange =
  | { kind: "add"; input: AddObjectiveInput }
  | { kind: "update"; id: number; patch: UpdateObjectiveInput }
  | { kind: "increment"; id: number; by: number }
  | { kind: "delete"; id: number }
  | { kind: "reorder"; ids: number[] };

/** Adicionar/editar/incrementar devolvem um `ObjectiveWriteResult` (veja `isObjectiveWrite`). */
function sendObjectiveChange(gameId: number, change: ObjectiveChange): Promise<unknown> {
  const param = { id: String("id" in change ? change.id : 0) };
  switch (change.kind) {
    case "add":
      return unwrap(
        api.library[":gameId"].objectives.$post({
          param: { gameId: String(gameId) },
          json: change.input,
        }),
      );
    case "update":
      return unwrap(api.objectives[":id"].$patch({ param, json: change.patch }));
    case "increment":
      return unwrap(api.objectives[":id"].increment.$post({ param, json: { by: change.by } }));
    case "delete":
      return unwrap(api.objectives[":id"].$delete({ param }));
    case "reorder":
      return unwrap(
        api.library[":gameId"].objectives.order.$put({
          param: { gameId: String(gameId) },
          json: { ids: change.ids },
        }),
      );
  }
}

const clampProgress = (o: ObjectiveItem, progress: number) =>
  Math.min(o.target, Math.max(0, progress));

/** Como a lista fica logo depois da mudança (antes da resposta), para a tela não esperar a rede. */
function applyObjectiveChange(list: ObjectiveItem[], change: ObjectiveChange): ObjectiveItem[] {
  switch (change.kind) {
    case "increment":
      return list.map((o) =>
        o.id === change.id ? { ...o, progress: clampProgress(o, o.progress + change.by) } : o,
      );
    case "update":
      return list.map((o) => {
        if (o.id !== change.id) return o;
        const next = { ...o, ...change.patch, description: o.description };
        return { ...next, progress: clampProgress(next, next.progress) };
      });
    case "delete":
      return list.filter((o) => o.id !== change.id);
    case "reorder": {
      const byId = new Map(list.map((o) => [o.id, o]));
      return change.ids.flatMap((id) => byId.get(id) ?? []);
    }
    case "add":
      return list;
  }
}

/**
 * Todas as escritas de objetivos por um hook só: atualização otimista, som quando o último é
 * concluído e o resultado (com `suggestFullCompletion`) para quem chamou decidir o que perguntar.
 */
export function useObjectiveChange(gameId: number) {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  const key = objectiveKeys.list(gameId);
  return useMutation({
    mutationFn: (change: ObjectiveChange) => sendObjectiveChange(gameId, change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ObjectiveItem[]>(key);
      if (previous) queryClient.setQueryData(key, applyObjectiveChange(previous, change));
      return { previous };
    },
    onError: (error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      onError(error);
    },
    onSuccess: (result) => {
      if (isObjectiveWrite(result) && result.allDoneNow) playMostImportant(["streak-milestone"]);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        // O item da biblioteca traz o resumo (feitos/total).
        queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
      ]),
  });
}

export const isObjectiveWrite = (result: unknown): result is ObjectiveWriteResult =>
  typeof result === "object" && result !== null && "allDoneNow" in result;

// ---------------------------------------------------------------------------
// Conquistas (listas da Steam e do RetroAchievements)

export const achievementKeys = {
  all: ["achievements"] as const,
  game: (gameId: number) => [...achievementKeys.all, gameId] as const,
  candidates: (gameId: number, query: AchievementCandidatesQuery) =>
    [...achievementKeys.all, gameId, "candidates", query] as const,
};

export const achievementsQuery = (gameId: number) =>
  queryOptions({
    queryKey: achievementKeys.game(gameId),
    queryFn: () =>
      unwrap(api.library[":gameId"].achievements.$get({ param: { gameId: String(gameId) } })),
  });

export const achievementCandidatesQuery = (gameId: number, query: AchievementCandidatesQuery) =>
  queryOptions({
    queryKey: achievementKeys.candidates(gameId, query),
    queryFn: () =>
      unwrap(
        api.library[":gameId"].achievements.candidates.$get({
          param: { gameId: String(gameId) },
          query: {
            ...(query.q && { q: query.q }),
            ...(query.consoleId && { consoleId: String(query.consoleId) }),
          },
        }),
      ),
    // Busca nas fontes (e pode buscar a lista da Steam): não repetir à toa.
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

/** O resumo das conquistas mora no item da biblioteca: atualiza a página e os cards. */
function setGameAchievements(
  queryClient: ReturnType<typeof useQueryClient>,
  gameId: number,
  data: GameAchievements,
) {
  queryClient.setQueryData(achievementKeys.game(gameId), data);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
    queryClient.invalidateQueries({ queryKey: [...achievementKeys.all, gameId, "candidates"] }),
  ]);
}

export function useLinkAchievementSet(gameId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkAchievementSetInput) =>
      unwrap(
        api.library[":gameId"].achievements.sets.$post({
          param: { gameId: String(gameId) },
          json: input,
        }),
      ),
    onSuccess: (data) => {
      toast.success("Lista de conquistas ligada");
      return setGameAchievements(queryClient, gameId, data);
    },
    onError,
  });
}

export function useUnlinkAchievementSet(gameId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (setId: number) =>
      unwrap(
        api.library[":gameId"].achievements.sets[":setId"].$delete({
          param: { gameId: String(gameId), setId: String(setId) },
        }),
      ),
    onSuccess: (data) => {
      toast.success("Lista desligada", {
        description: "Os desbloqueios ficam guardados se você ligar de novo.",
      });
      return setGameAchievements(queryClient, gameId, data);
    },
    onError,
  });
}

export function useRefreshAchievements(gameId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.library[":gameId"].achievements.refresh.$post({ param: { gameId: String(gameId) } }),
      ),
    onSuccess: (data) => {
      toast.success("Listas atualizadas");
      return setGameAchievements(queryClient, gameId, data);
    },
    onError,
  });
}

export interface AchievementChange {
  ids: number[];
  unlocked: boolean;
  unlockedOn?: string;
}

function sendAchievementChange(gameId: number, { ids, ...input }: AchievementChange) {
  const [only] = ids;
  if (ids.length === 1 && only !== undefined) {
    return unwrap(
      api.library[":gameId"].achievements[":achievementId"].$patch({
        param: { gameId: String(gameId), achievementId: String(only) },
        json: input,
      }),
    );
  }
  return unwrap(
    api.library[":gameId"].achievements.$patch({
      param: { gameId: String(gameId) },
      json: { ids, ...input },
    }),
  );
}

const sumPoints = (list: AchievementItem[]) => list.reduce((sum, a) => sum + (a.points ?? 0), 0);

function summarizeAchievements(items: AchievementItem[]): AchievementsSummary {
  const active = items.filter((a) => !a.removed);
  const unlocked = active.filter((a) => a.unlockedAt);
  return {
    total: active.length,
    unlocked: unlocked.length,
    points: sumPoints(active),
    pointsUnlocked: sumPoints(unlocked),
  };
}

/** Como as listas ficam logo depois de marcar (antes da resposta). */
function applyAchievementChange(
  data: GameAchievements,
  { ids, unlocked }: AchievementChange,
  now: string,
): GameAchievements {
  const changed = new Set(ids);
  const sets: AchievementSetItem[] = data.sets.map((set) => {
    const achievements = set.achievements.map((a) => {
      if (!changed.has(a.id)) return a;
      if (!unlocked) return { ...a, unlockedAt: null, origin: null };
      return a.unlockedAt ? a : { ...a, unlockedAt: now, origin: "manual" as const };
    });
    return { ...set, ...summarizeAchievements(achievements), achievements };
  });
  const all = sets.flatMap((s) => s.achievements);
  return { ...data, sets, summary: sets.length > 0 ? summarizeAchievements(all) : null };
}

/**
 * Marcar e desmarcar conquistas: atualização otimista, som quando a última é desbloqueada e o
 * resultado (com `suggestFullCompletion`) para quem chamou decidir o que perguntar.
 */
export function useAchievementChange(gameId: number) {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  const key = achievementKeys.game(gameId);
  return useMutation({
    mutationFn: (change: AchievementChange) => sendAchievementChange(gameId, change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<GameAchievements>(key);
      if (previous) {
        const next = applyAchievementChange(previous, change, new Date().toISOString());
        queryClient.setQueryData(key, next);
      }
      return { previous };
    },
    onError: (error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      onError(error);
    },
    onSuccess: (result) => {
      if (result.allDoneNow) playMostImportant(["streak-milestone"]);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
      ]),
  });
}

// ---------------------------------------------------------------------------
// Steam: o perfil de quem usa o app e a sincronização (conquistas e horas)

export const steamKeys = {
  profile: ["steam", "profile"] as const,
  importPreview: ["steam", "import"] as const,
};

export const steamProfileQuery = () =>
  queryOptions({
    queryKey: steamKeys.profile,
    queryFn: () => unwrap(api.steam.profile.$get()),
    staleTime: 5 * 60_000,
  });

export function useLinkSteamProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkSteamProfileInput) => unwrap(api.steam.profile.$put({ json: input })),
    onSuccess: (data) => {
      queryClient.setQueryData(steamKeys.profile, data);
      if (data.profile) toast.success(`Steam conectada: ${data.profile.name}`);
    },
    onError,
  });
}

export function useUnlinkSteamProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.steam.profile.$delete()),
    onSuccess: (data) => {
      queryClient.setQueryData(steamKeys.profile, data);
      toast.success("Steam desconectada");
    },
    onError,
  });
}

/** Sincroniza um jogo; o item e as conquistas voltam atualizados na resposta. */
export function useSyncSteamGame(gameId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.library[":gameId"].steam.sync.$post({ param: { gameId: String(gameId) } })),
    onSuccess: ({ sync, item, achievements }) => {
      const { title, description } = gameSyncMessage(sync);
      toast.success(title, { description });
      setLibraryItem(queryClient, item);
      // Deu certo: o servidor limpou o erro da automática.
      setAutoSyncState(queryClient, (auto) => auto && { ...auto, lastError: null });
      return Promise.all([
        setGameAchievements(queryClient, gameId, achievements),
        // O jogado na Steam desde a última vez pode ter virado sessão.
        queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
        queryClient.invalidateQueries({ queryKey: statsKeys.all }),
      ]);
    },
    onError,
  });
}

export function useSyncSteamLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.steam.sync.$post()),
    onSuccess: (sync) => {
      const { title, description } = librarySyncMessage(sync);
      toast.success(title, { description });
      // O servidor zerou o relógio da automática.
      setAutoSyncState(queryClient, () => ({ lastRunAt: sync.syncedAt, lastError: null }));
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
        queryClient.invalidateQueries({ queryKey: achievementKeys.all }),
        queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
        queryClient.invalidateQueries({ queryKey: statsKeys.all }),
      ]);
    },
    onError,
  });
}

/** Os jogos da conta Steam que ainda não estão na biblioteca (só com o diálogo aberto). */
export const steamImportPreviewQuery = () =>
  queryOptions({
    queryKey: steamKeys.importPreview,
    queryFn: () => unwrap(api.steam.import.$get()),
    // A conta e a biblioteca mudam por fora: sempre de novo ao abrir.
    staleTime: 0,
    gcTime: 60_000,
  });

export interface SteamImportProgress {
  /** Jogos que já tiveram as conquistas e as horas buscadas. */
  done: number;
  total: number;
}

/**
 * Importa os jogos escolhidos e, em seguida, busca as conquistas e as horas deles em lotes (cada
 * lote é um pedido curto, e dá para mostrar o progresso). Se um lote falhar, para por ali: a
 * sincronização automática termina os que faltaram.
 */
export function useImportSteamGames() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      input,
      onProgress,
    }: {
      input: SteamImportInput;
      onProgress: (progress: SteamImportProgress) => void;
    }) => {
      const result = await unwrap(api.steam.import.$post({ json: input }));
      const ids = result.added.map((a) => a.gameId);
      let newUnlocks = 0;
      let interrupted = false;
      onProgress({ done: 0, total: ids.length });
      for (let i = 0; i < ids.length; i += STEAM_SYNC_GAMES_BATCH) {
        const gameIds = ids.slice(i, i + STEAM_SYNC_GAMES_BATCH);
        try {
          // Um lote de cada vez: o servidor já vai no ritmo da Steam.
          // oxlint-disable-next-line no-await-in-loop
          const sync = await unwrap(api.steam.sync.games.$post({ json: { gameIds } }));
          newUnlocks += sync.newUnlocks;
        } catch {
          interrupted = true;
          break;
        }
        onProgress({ done: Math.min(i + gameIds.length, ids.length), total: ids.length });
      }
      return { ...result, newUnlocks, interrupted };
    },
    onSuccess: (result) => {
      const { title, description } = importMessage(result);
      toast.success(title, { description });
    },
    onError,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: steamKeys.importPreview }),
        queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
        queryClient.invalidateQueries({ queryKey: achievementKeys.all }),
        queryClient.invalidateQueries({ queryKey: statsKeys.all }),
      ]),
  });
}

/**
 * Sincronização automática (ao abrir o app). Silenciosa: só avisa se trouxe conquistas novas, e
 * erros ficam no estado (aparecem nos Ajustes) em vez de virar toast.
 */
export function useAutoSyncSteam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.steam.sync.auto.$post()),
    onSuccess: (sync) => {
      setAutoSyncState(queryClient, () => sync.state);
      if (sync.games.length === 0) return;
      const message = autoSyncMessage(sync);
      if (message) toast.success(message.title, { description: message.description });
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
        queryClient.invalidateQueries({ queryKey: achievementKeys.all }),
        queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
        queryClient.invalidateQueries({ queryKey: statsKeys.all }),
      ]);
    },
  });
}

function setAutoSyncState(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (auto: SteamAutoSyncState | null) => SteamAutoSyncState | null,
) {
  // O queryKey do queryOptions carrega o tipo da resposta.
  queryClient.setQueryData(steamProfileQuery().queryKey, (data) =>
    data ? { ...data, auto: update(data.auto) } : data,
  );
}
