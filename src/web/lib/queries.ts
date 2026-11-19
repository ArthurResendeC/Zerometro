import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { gameStatusLabels } from "@shared/domain";
import type { AddToLibraryInput, LibraryListQuery, UpdateLibraryEntryInput } from "@shared/library";
import { api, unwrap } from "@/lib/api";

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
      return queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
    onError,
  });
}
