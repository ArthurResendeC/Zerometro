import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { igdbIdSchema } from "@shared/igdb";
import type { LibraryItem } from "@shared/library";
import { formatScore } from "@shared/ratings";
import { ArrowLeftIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RatingWizard } from "@/features/rating/rating-wizard";
import {
  completionsQuery,
  libraryByIgdbQuery,
  ratingTemplateQuery,
  useCreateRating,
} from "@/lib/queries";

// Avaliação guiada de um jogo da biblioteca, em página inteira (dá para recarregar e voltar).
// ?rapida=1 começa direto na nota de coração.

const searchSchema = z.object({
  rapida: z.coerce.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/jogo/$igdbId_/avaliar")({
  params: {
    parse: (raw) => ({ igdbId: igdbIdSchema.parse(raw.igdbId) }),
    stringify: ({ igdbId }) => ({ igdbId: String(igdbId) }),
  },
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    const item = await context.queryClient.ensureQueryData(libraryByIgdbQuery(params.igdbId));
    if (item) {
      await Promise.all([
        context.queryClient.ensureQueryData(ratingTemplateQuery(item.gameId)),
        context.queryClient.ensureQueryData(completionsQuery(item.gameId)),
      ]);
    }
  },
  component: RatePage,
  pendingComponent: () => <Skeleton className="h-96 w-full" />,
  errorComponent: () => (
    <div className="space-y-4">
      <p className="text-muted-foreground">Não foi possível abrir a avaliação.</p>
      <Button asChild variant="outline">
        <Link to="/biblioteca">Voltar para a biblioteca</Link>
      </Button>
    </div>
  ),
});

function RatePage() {
  const { igdbId } = Route.useParams();
  const { rapida } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: item } = useSuspenseQuery(libraryByIgdbQuery(igdbId));

  if (!item) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Só dá para avaliar jogos da biblioteca.</p>
        <Button asChild variant="outline">
          <Link to="/jogo/$igdbId" params={{ igdbId }}>
            Voltar para o jogo
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/jogo/$igdbId" params={{ igdbId }} search={{ aba: "sessoes" }}>
          <ArrowLeftIcon /> {item.name}
        </Link>
      </Button>
      <Wizard
        item={item}
        quick={rapida === true}
        onSaved={() =>
          void navigate({ to: "/jogo/$igdbId", params: { igdbId }, search: { aba: "sessoes" } })
        }
      />
    </div>
  );
}

function Wizard({
  item,
  quick,
  onSaved,
}: {
  item: LibraryItem;
  quick: boolean;
  onSaved: () => void;
}) {
  const { data: template } = useSuspenseQuery(ratingTemplateQuery(item.gameId));
  const completions = useQuery(completionsQuery(item.gameId)).data ?? [];
  const create = useCreateRating(item.gameId);

  return (
    <RatingWizard
      item={item}
      template={template}
      completions={completions}
      quickStart={quick}
      saving={create.isPending}
      onSave={async (input) => {
        const { rating } = await create.mutateAsync(input);
        toast.success(`${item.name}: nota ${formatScore(rating.final)}`, {
          description: rating.weighted === null ? "Nota de coração salva" : "Avaliação salva",
        });
        onSaved();
      }}
    />
  );
}
