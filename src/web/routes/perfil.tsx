import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { gameModeLabel, perspectiveLabel, themeLabel } from "@shared/game-labels";
import { genreLabel } from "@shared/genres";
import {
  type GamerProfile,
  MIN_RATED_GAMES,
  type ProfileRow,
  type ProfileSection,
  type ProfileSort,
  profileSortLabels,
  sortProfileRows,
} from "@shared/profile";
import { GameCover } from "@/components/game-cover";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card } from "@/components/ui/card";
import { BarList } from "@/features/stats/bar-list";
import { formatMinutes } from "@/lib/format";
import { profileQuery } from "@/lib/queries";

/** Linhas por ranking. */
const ROWS_SHOWN = 8;

/** A ordem no endereço, em português (?por=zerados). */
const sortParams = { horas: "minutes", zerados: "finished", nota: "rating" } as const;
type SortParam = keyof typeof sortParams;
const sortParamOf = Object.fromEntries(
  Object.entries(sortParams).map(([param, sort]) => [sort, param]),
) as Record<ProfileSort, SortParam>;

const searchSchema = z.object({
  por: z.enum(["horas", "zerados", "nota"]).optional().catch(undefined),
});

export const Route = createFileRoute("/perfil")({
  validateSearch: searchSchema,
  loader: ({ context }) => context.queryClient.ensureQueryData(profileQuery()),
  component: ProfilePage,
});

interface SectionInfo {
  section: ProfileSection;
  title: string;
  /** Explica o que entra (uma linha). */
  hint?: string;
  label?: (name: string) => string;
  /** Capas: uma (a do jogo mais jogado) ou várias (séries). */
  covers: "one" | "many" | "none";
  color?: string;
}

const sections: SectionInfo[] = [
  { section: "developers", title: "Desenvolvedoras favoritas", covers: "one" },
  {
    section: "publishers",
    title: "Publishers favoritas",
    hint: "As que o IGDB credita, inclusive as regionais.",
    covers: "one",
    color: "var(--chart-3)",
  },
  {
    section: "series",
    title: "Séries mais jogadas",
    covers: "many",
    color: "var(--primary)",
  },
  {
    section: "franchises",
    title: "Franquias",
    hint: "Mais amplas que as séries (ex.: Mario inteiro).",
    covers: "many",
    color: "var(--primary)",
  },
  {
    section: "genres",
    title: "Gêneros",
    hint: "Um jogo com vários gêneros conta em todos eles.",
    label: genreLabel,
    covers: "none",
  },
  { section: "themes", title: "Temas", label: themeLabel, covers: "none" },
  {
    section: "perspectives",
    title: "Perspectiva",
    label: perspectiveLabel,
    covers: "none",
    color: "var(--chart-3)",
  },
  {
    section: "gameModes",
    title: "Modos de jogo",
    label: gameModeLabel,
    covers: "none",
    color: "var(--chart-3)",
  },
  {
    section: "platforms",
    title: "Plataformas",
    hint: "Onde você jogou (definido em cada jogo).",
    covers: "none",
  },
];

function ProfilePage() {
  const { por } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: profile } = useSuspenseQuery(profileQuery());
  const sort: ProfileSort = sortParams[por ?? "horas"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display-lg">Perfil de gamer</h1>
        <p className="mt-2 text-muted-foreground">
          {profile.gamesCounted === 0
            ? "Seu gosto aparece aqui quando você jogar ou zerar alguns jogos."
            : `Seu gosto pelos ${profile.gamesCounted} ${profile.gamesCounted === 1 ? "jogo" : "jogos"} que você jogou ou zerou (${formatMinutes(profile.totalMinutes)} no total).`}
        </p>
      </div>

      <SegmentedToggle
        legend="Ordenar por"
        options={(Object.keys(profileSortLabels) as ProfileSort[]).map((value) => ({
          value,
          label: profileSortLabels[value],
        }))}
        value={sort}
        onChange={(value) =>
          navigate({
            search: { por: value === "minutes" ? undefined : sortParamOf[value] },
            replace: true,
          })
        }
      />

      <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
        {sections.map((info) => (
          <RankingCard key={info.section} info={info} profile={profile} sort={sort} />
        ))}
      </div>
    </div>
  );
}

function RankingCard({
  info,
  profile,
  sort,
}: {
  info: SectionInfo;
  profile: GamerProfile;
  sort: ProfileSort;
}) {
  const rows = sortProfileRows(profile[info.section], sort);
  const shown = rows.slice(0, ROWS_SHOWN);
  const hidden = rows.length - shown.length;
  const label = info.label ?? ((name: string) => name);

  return (
    <Card className="gap-4">
      <div>
        <h2 className="display-xs text-muted-foreground">{info.title}</h2>
        {info.hint && <p className="mt-1 text-xs text-muted-foreground">{info.hint}</p>}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText(sort)}</p>
      ) : (
        <>
          <BarList
            color={info.color}
            items={shown.map((row) =>
              Object.assign(valueOf(row, sort), {
                key: row.key,
                label: label(row.name),
                minutes: row.minutes,
                hint: hintOf(row, sort),
                leading: <Covers row={row} mode={info.covers} />,
              }),
            )}
          />
          {hidden > 0 && <p className="text-xs text-muted-foreground">E mais {hidden}.</p>}
        </>
      )}
    </Card>
  );
}

/** O que a barra mede e o valor à direita, conforme a ordem. */
function valueOf(row: ProfileRow, sort: ProfileSort): { value?: number; display?: string } {
  switch (sort) {
    case "minutes":
      return {};
    case "finished":
      return { value: row.finished, display: `${row.finished} ${plural(row.finished, "zerado")}` };
    case "rating":
      return {
        value: row.avgRating ?? 0,
        display: `nota ${(row.avgRating ?? 0).toLocaleString("pt-BR")}`,
      };
  }
}

/** O texto secundário: quantos jogos e, fora da ordem por horas, o tempo. */
function hintOf(row: ProfileRow, sort: ProfileSort): string {
  const games = `${row.games} ${plural(row.games, "jogo")}`;
  if (sort === "minutes") {
    return row.finished > 0
      ? `${games} · ${row.finished} ${plural(row.finished, "zerado")}`
      : games;
  }
  if (sort === "rating") return `${row.ratedGames} com nota · ${formatMinutes(row.minutes)}`;
  return `${games} · ${formatMinutes(row.minutes)}`;
}

function emptyText(sort: ProfileSort): string {
  switch (sort) {
    case "minutes":
      return "Nada aqui ainda.";
    case "finished":
      return "Nenhum jogo zerado aqui ainda.";
    case "rating":
      return `Dê nota a pelo menos ${MIN_RATED_GAMES} jogos de um mesmo item para ele entrar.`;
  }
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function Covers({ row, mode }: { row: ProfileRow; mode: SectionInfo["covers"] }) {
  if (mode === "none") return null;
  const games = mode === "one" ? row.topGames.slice(0, 1) : row.topGames.slice(0, 3);
  return (
    <div className="flex shrink-0 -space-x-3" title={row.topGames.map((g) => g.name).join(", ")}>
      {games.map((game) => (
        <GameCover
          key={game.gameId}
          name={game.name}
          imageId={game.coverImageId}
          size="thumb"
          className="w-8 shrink-0"
        />
      ))}
    </div>
  );
}
