import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { type GameStatus, gameStatuses, gameStatusLabels } from "@shared/domain";
import type { IgdbGameSummary } from "@shared/igdb";
import type { LibraryItem } from "@shared/library";
import { GameCover } from "@/components/game-cover";
import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { igdbSearchQuery, libraryListQuery, useAddToLibrary } from "@/lib/queries";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
});

export const Route = createFileRoute("/adicionar")({
  validateSearch: searchSchema,
  component: AddGamePage,
});

function AddGamePage() {
  const { q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const search = useQuery(igdbSearchQuery(q));
  const library = useQuery(libraryListQuery());

  // igdbId → item da biblioteca, para marcar o que já foi adicionado.
  const inLibrary = new Map(library.data?.items.map((item) => [item.igdbId, item]));
  const tooShort = q.trim().length < 2;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Adicionar jogo</h1>
        <p className="text-sm text-muted-foreground">Busca no IGDB. Escolha a versão certa.</p>
      </div>

      <SearchInput
        value={q}
        onChange={(next) => navigate({ search: { q: next || undefined }, replace: true })}
        placeholder="Ex.: Persona 5 Royal"
      />

      {tooShort ? (
        <p className="text-sm text-muted-foreground">Digite pelo menos 2 letras.</p>
      ) : search.isError ? (
        <p className="text-sm text-destructive">{search.error.message}</p>
      ) : !search.data ? (
        <ResultsSkeleton />
      ) : search.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada encontrado para “{q}”.</p>
      ) : (
        <ul
          className={cn(
            "divide-y rounded-xl border transition-opacity",
            search.isFetching && "opacity-60",
          )}
        >
          {search.data.map((game) => (
            <ResultRow key={game.igdbId} game={game} existing={inLibrary.get(game.igdbId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ResultRow({ game, existing }: { game: IgdbGameSummary; existing?: LibraryItem }) {
  const [status, setStatus] = useState<GameStatus>("backlog");
  const add = useAddToLibrary();
  const meta = [game.releaseYear, game.gameType, game.platforms.join(", ")].filter(Boolean);

  return (
    <li className="flex items-center gap-4 p-3">
      <GameCover name={game.name} imageId={game.coverImageId} size="cover_small" className="w-12" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{game.name}</p>
        <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
      </div>

      {existing ? (
        <Link to="/jogos/$gameId" params={{ gameId: existing.gameId }}>
          <Badge variant="secondary">
            <Check /> {gameStatusLabels[existing.status]}
          </Badge>
        </Link>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <NativeSelect
            aria-label={`Status de ${game.name}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as GameStatus)}
            className="hidden w-32 sm:block"
          >
            {gameStatuses.map((s) => (
              <option key={s} value={s}>
                {gameStatusLabels[s]}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            disabled={add.isPending}
            onClick={() => add.mutate({ igdbId: game.igdbId, status })}
          >
            <Plus /> Adicionar
          </Button>
        </div>
      )}
    </li>
  );
}

function ResultsSkeleton() {
  return (
    <div className="divide-y rounded-xl border">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 p-3">
          <Skeleton className="aspect-3/4 w-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
