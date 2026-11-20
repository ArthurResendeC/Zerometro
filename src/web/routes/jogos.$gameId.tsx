import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { libraryItemQuery } from "@/lib/queries";

// Endereço antigo da página do jogo (pelo id interno da biblioteca). A página agora é aberta
// pelo id do IGDB em /jogo/$igdbId; este só redireciona links e favoritos antigos.

export const Route = createFileRoute("/jogos/$gameId")({
  params: {
    parse: (raw) => ({ gameId: z.coerce.number().int().positive().parse(raw.gameId) }),
    stringify: ({ gameId }) => ({ gameId: String(gameId) }),
  },
  loader: async ({ context, params }) => {
    const item = await context.queryClient.ensureQueryData(libraryItemQuery(params.gameId));
    throw redirect({ to: "/jogo/$igdbId", params: { igdbId: item.igdbId }, replace: true });
  },
  errorComponent: ({ error }) => (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {error instanceof ApiError && error.status === 404
          ? "Esse jogo não está na biblioteca."
          : "Não foi possível carregar o jogo."}
      </p>
      <Button asChild variant="outline">
        <Link to="/biblioteca">Voltar para a biblioteca</Link>
      </Button>
    </div>
  ),
});
