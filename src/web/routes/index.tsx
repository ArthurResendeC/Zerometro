import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { GameCard, GameGrid } from "@/components/game-card";
import { Button } from "@/components/ui/button";
import { libraryListQuery } from "@/lib/queries";

const playingQuery = libraryListQuery({ status: "playing" });

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(playingQuery),
  component: Home,
});

function Home() {
  const { data } = useSuspenseQuery(playingQuery);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jogando agora</h1>
        <p className="text-sm text-muted-foreground">Quanto falta pra zerar?</p>
      </div>

      {data.items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <p className="text-muted-foreground">Nenhum jogo em andamento.</p>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/adicionar">Adicionar jogo</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/biblioteca" search={{ status: "backlog" }}>
                Ver próximos
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <GameGrid>
          {data.items.map((item) => (
            <GameCard key={item.gameId} item={item} />
          ))}
        </GameGrid>
      )}
    </section>
  );
}
