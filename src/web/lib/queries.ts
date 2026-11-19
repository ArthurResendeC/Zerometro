import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type GameStatus, gameStatusLabels } from "@shared/domain";
import type { AddToLibraryInput, LibraryListQuery, UpdateLibraryEntryInput } from "@shared/library";
import type {
  ListSessionsQuery,
  LogSessionInput,
  LogSessionResult,
  UpdateSessionInput,
} from "@shared/sessions";
import type { UpdateSettingsInput } from "@shared/settings";
import type { StartTimerInput, StopTimerInput, StopTimerResult } from "@shared/timer";
import type { UpdateLibraryEntryResult } from "@shared/library";
import { reachedStreakMilestone } from "@/features/audio/sound-events";
import type { SoundName } from "@/features/audio/sounds";
import { useSound } from "@/features/audio/use-sound";
import { ApiError, api, unwrap } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { formatMinutes } from "@/lib/format";

// Query keys e queryOptions centralizados: rotas usam no loader e componentes no useQuery.

export const libraryKeys = {
  all: ["library"] as const,
  list: (filters: LibraryListQuery) => [...libraryKeys.all, "list", filters] as const,
  item: (gameId: number) => [...libraryKeys.all, "item", gameId] as const,
};

export const libraryListQuery = (filters: LibraryListQuery = {}) =>
  queryOptions({
    queryKey: libraryKeys.list(filters),
    queryFn: () =>
      unwrap(
        api.library.$get({
          query: {
            ...(filters.status && { status: filters.status }),
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
      return queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
    onError,
  });
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
      queryClient.setQueryData(libraryKeys.item(gameId), result.item);
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
      queryClient.setQueryData(libraryKeys.item(result.item.gameId), result.item);
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

export function useLogSession() {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  return useMutation({
    mutationFn: (input: LogSessionInput) => unwrap(api.sessions.$post({ json: input })),
    onSuccess: (result) => {
      playMostImportant(sessionSavedSounds(result));
      toastSessionSaved(result);
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

export function useStartTimer() {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  const mutation = useMutation({
    mutationFn: (input: StartTimerInput) => unwrap(api.timer.start.$post({ json: input })),
    onSuccess: (result) => {
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

export function useStopTimer() {
  const queryClient = useQueryClient();
  const { playMostImportant } = useSound();
  return useMutation({
    mutationFn: (input: StopTimerInput) => unwrap(api.timer.stop.$post({ json: input })),
    onSuccess: (result) => {
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
    mutationFn: async () => (await unwrap(api.timer.$delete())).cancelled,
    onSuccess: (cancelled) => {
      toast.info(`Timer de ${cancelled.gameName} descartado`);
      return invalidateGameData(queryClient);
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
    queryFn: async () => (await authClient.getSession()).data ?? null,
    staleTime: 5 * 60_000,
  });
