import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { gameStatusLabels } from "@shared/domain";
import type { AddToLibraryInput, LibraryListQuery, UpdateLibraryEntryInput } from "@shared/library";
import type { ListSessionsQuery, LogSessionInput, UpdateSessionInput } from "@shared/sessions";
import type { UpdateSettingsInput } from "@shared/settings";
import { api, unwrap } from "@/lib/api";
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

export function useUpdateLibraryEntry(gameId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateLibraryEntryInput) =>
      (
        await unwrap(
          api.library[":gameId"].$patch({ param: { gameId: String(gameId) }, json: patch }),
        )
      ).item,
    onSuccess: (item) => {
      queryClient.setQueryData(libraryKeys.item(gameId), item);
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

/** Sessões mudam totais da biblioteca e as estatísticas. */
function invalidateGameData(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: libraryKeys.all }),
    queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
    queryClient.invalidateQueries({ queryKey: statsKeys.all }),
  ]);
}

export function useLogSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LogSessionInput) => unwrap(api.sessions.$post({ json: input })),
    onSuccess: (result) => {
      const { session, dayTotalMinutes, statusChangedTo } = result;
      toast.success(`${formatMinutes(session.minutes)} de ${session.gameName} registrados`, {
        description: [
          `Total do dia: ${formatMinutes(dayTotalMinutes)}`,
          statusChangedTo && `Agora em ${gameStatusLabels[statusChangedTo]}`,
        ]
          .filter(Boolean)
          .join(" · "),
      });
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
