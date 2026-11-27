import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DEFAULT_TIME_ZONE, todayIn } from "@shared/dates";
import { completionTypeLabels } from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import { criteriaById, type CriterionId, presetDefs } from "@shared/rating-criteria";
import { formatScore, type RatingItem, ratingModeLabels } from "@shared/ratings";
import { StarIcon, TrashIcon } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RatingRadar } from "@/features/rating/rating-radar";
import { useRatingDrafts } from "@/features/rating/rating-draft-store";
import { formatDate } from "@/lib/format";
import { completionsQuery, gameRatingsQuery, useDeleteRating } from "@/lib/queries";

// Seção "Avaliação" da página do jogo: a avaliação atual (radar, as três notas, review), o
// histórico (uma por playthrough ou reavaliação) e o botão para avaliar.

/** Dia (no fuso do usuário) de um instante ISO. */
const dateOf = (iso: string) => formatDate(todayIn(DEFAULT_TIME_ZONE, new Date(iso)));

export function RatingSection({ item }: { item: LibraryItem }) {
  const ratings = useQuery(gameRatingsQuery(item.gameId));
  const completions = useQuery(completionsQuery(item.gameId)).data ?? [];
  const hasDraft = useRatingDrafts((s) => s.drafts[item.gameId] !== undefined);
  const [latest, ...previous] = ratings.data ?? [];
  const completionLabel = (id: number | null) => {
    const found = id === null ? undefined : completions.find((c) => c.id === id);
    return found ? `${completionTypeLabels[found.type]} em ${formatDate(found.completedOn)}` : null;
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="display-md">Avaliação</h2>
        <div className="flex flex-wrap justify-end">
          <Button asChild size="sm" variant={latest ? "outline" : "default"}>
            <Link to="/jogo/$igdbId/avaliar" params={{ igdbId: item.igdbId }}>
              <StarIcon /> {hasDraft ? "Continuar avaliação" : latest ? "Reavaliar" : "Avaliar"}
            </Link>
          </Button>
          {!latest && !hasDraft && (
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/jogo/$igdbId/avaliar"
                params={{ igdbId: item.igdbId }}
                search={{ rapida: true }}
              >
                Só dar uma nota
              </Link>
            </Button>
          )}
        </div>
      </div>

      {ratings.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : !latest ? (
        <p className="text-sm text-muted-foreground">
          Ainda sem nota. A avaliação guiada leva uns 2 minutos, um critério por vez.{" "}
          <Link to="/como-avaliamos" className="text-info underline">
            Como avaliamos
          </Link>
        </p>
      ) : (
        <>
          <CurrentRating rating={latest} playthrough={completionLabel(latest.completionId)} />
          {previous.length > 0 && (
            <div className="space-y-2">
              <h3 className="display-xs">Avaliações anteriores</h3>
              <ul className="space-y-1">
                {previous.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="tabular-nums">{formatScore(r.final)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {dateOf(r.createdAt)}
                        {completionLabel(r.completionId) && ` · ${completionLabel(r.completionId)}`}
                      </span>
                    </span>
                    <DeleteRatingButton rating={r} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CurrentRating({
  rating,
  playthrough,
}: {
  rating: RatingItem;
  playthrough: string | null;
}) {
  const notes = Object.entries(rating.criterionNotes ?? {}) as [CriterionId, string][];
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Nota final</p>
          <p className="display-xl tabular-nums">{formatScore(rating.final)}</p>
        </div>
        <dl className="flex gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Calculada</dt>
            <dd className="tabular-nums">
              {rating.weighted === null ? "—" : formatScore(rating.weighted)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Coração</dt>
            <dd className="tabular-nums">{formatScore(rating.enjoyment)}</dd>
          </div>
        </dl>
      </div>
      <p className="text-xs text-muted-foreground">
        {dateOf(rating.createdAt)} · {ratingModeLabels[rating.mode]}
        {rating.applicableCount > 0 && ` · ${presetDefs[rating.preset].label}`}
        {playthrough && ` · ${playthrough}`}
      </p>

      <RatingRadar
        scores={rating.scores}
        caption="Notas por critério da avaliação atual, de 1 a 7"
      />

      {rating.review && <p className="whitespace-pre-line">{rating.review}</p>}
      {notes.length > 0 && (
        <dl className="space-y-1 text-sm">
          {notes.map(([id, text]) => (
            <div key={id}>
              <dt className="inline text-muted-foreground">{criteriaById[id].label}: </dt>
              <dd className="inline">{text}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex justify-end">
        <DeleteRatingButton rating={rating} />
      </div>
    </Card>
  );
}

function DeleteRatingButton({ rating }: { rating: RatingItem }) {
  const remove = useDeleteRating();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Apagar avaliação">
          <TrashIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar esta avaliação?</AlertDialogTitle>
          <AlertDialogDescription>
            Nota {formatScore(rating.final)}, de {dateOf(rating.createdAt)}. A nota do jogo passa a
            ser a da avaliação anterior (se houver).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate(rating.id)}>Apagar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
