import { queryOptions } from "@tanstack/react-query";
import type { GroupPeriod } from "@shared/group";
import { api, unwrap } from "@/lib/api";
import { statsKeys } from "@/lib/queries";

// Debaixo de "stats": registrar sessão, zerar ou desbloquear conquista já atualiza o grupo.
const groupKey = [...statsKeys.all, "group"] as const;

export const leaderboardQuery = (period: GroupPeriod) =>
  queryOptions({
    queryKey: [...groupKey, "leaderboard", period],
    queryFn: () => unwrap(api.group.leaderboard.$get({ query: { period } })),
    // Os outros jogam sem a gente saber: vale buscar de novo ao voltar para a tela.
    staleTime: 60_000,
  });

export const memberProfileQuery = (handle: string) =>
  queryOptions({
    queryKey: [...groupKey, "member", handle],
    queryFn: () => unwrap(api.group.members[":handle"].$get({ param: { handle } })),
    staleTime: 60_000,
  });

export const gameInGroupQuery = (igdbId: number) =>
  queryOptions({
    queryKey: [...groupKey, "game", igdbId],
    queryFn: () => unwrap(api.group.games[":igdbId"].$get({ param: { igdbId: String(igdbId) } })),
    staleTime: 60_000,
  });
