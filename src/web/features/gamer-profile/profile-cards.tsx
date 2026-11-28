import { Link } from "@tanstack/react-router";
import { gameModeLabel, perspectiveLabel, themeLabel } from "@shared/game-labels";
import { genreLabel } from "@shared/genres";
import {
  MIN_RATED_GAMES,
  type ProfileRow,
  type ProfileSection,
  type ProfileSort,
  profileSortLabels,
  sortProfileRows,
} from "@shared/profile";
import type { CriterionAverage } from "@shared/ratings";
import { criteriaById, SCORE_MAX } from "@shared/rating-criteria";
import { GameCover } from "@/components/game-cover";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card } from "@/components/ui/card";
import { BarList } from "@/features/stats/bar-list";
import { formatMinutes } from "@/lib/format";

// Os cards do perfil de gamer: o seu, em /perfil, e o de um amigo, no /amigo. `person` é o
// nome de quem está sendo visto (sem ele, o texto fala com "você").

/** Linhas por ranking. */
const ROWS_SHOWN = 8;

/** A ordem no endereço, em português (?por=zerados). */
export const sortParams = { horas: "minutes", zerados: "finished", nota: "rating" } as const;
export type SortParam = keyof typeof sortParams;
export const sortParamOf = Object.fromEntries(
  Object.entries(sortParams).map(([param, sort]) => [sort, param]),
) as Record<ProfileSort, SortParam>;

export interface RankingInfo {
  section: ProfileSection;
  title: string;
  /** Explica o que entra (uma linha). */
  hint?: string;
  label?: (name: string) => string;
  /** Capas: uma (a do jogo mais jogado) ou várias (séries). */
  covers: "one" | "many" | "none";
  color?: string;
}

export const rankings: RankingInfo[] = [
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
    hint: "A plataforma em que jogou (definida em cada jogo).",
    covers: "none",
  },
];

/** Horas, zerados ou nota média (sem as notas, a ordem por nota some). */
export function ProfileSortToggle({
  value,
  onChange,
  withRating = true,
}: {
  value: ProfileSort;
  onChange: (sort: ProfileSort) => void;
  withRating?: boolean;
}) {
  return (
    <SegmentedToggle
      legend="Ordenar por"
      options={(Object.keys(profileSortLabels) as ProfileSort[])
        .filter((sort) => withRating || sort !== "rating")
        .map((sort) => ({ value: sort, label: profileSortLabels[sort] }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** "O que você mais valoriza": a média de cada critério das avaliações, com o maior e o menor. */
export function CriteriaCard({
  criteria,
  person,
}: {
  criteria: CriterionAverage[];
  person?: string;
}) {
  return (
    <Card className="gap-4">
      <div>
        <h2 className="display-xs text-muted-foreground">O que {person ?? "você"} mais valoriza</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Média de cada critério nas {person ? `avaliações de ${person}` : "suas avaliações"} (de 1
          a 7), da maior para a menor.{" "}
          <Link to="/como-avaliamos" className="text-info underline">
            Como avaliamos
          </Link>
        </p>
      </div>
      <BarList
        color="var(--chart-1)"
        max={SCORE_MAX}
        items={criteria.map((c) => ({
          key: c.criterion,
          label: criteriaById[c.criterion].label,
          minutes: 0,
          value: c.average,
          display: `${c.average.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} de ${SCORE_MAX}`,
          hint: [
            `${c.count} ${plural(c.count, "jogo")}`,
            c.best && `maior: ${c.best.name} (${c.best.score})`,
            c.worst && `menor: ${c.worst.name} (${c.worst.score})`,
          ]
            .filter(Boolean)
            .join(" · "),
        }))}
      />
    </Card>
  );
}

export function RankingCard({
  info,
  rows: allRows,
  sort,
  person,
}: {
  info: RankingInfo;
  rows: readonly ProfileRow[];
  sort: ProfileSort;
  person?: string;
}) {
  const rows = sortProfileRows(allRows, sort);
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
        <p className="text-sm text-muted-foreground">{emptyText(sort, person)}</p>
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

function emptyText(sort: ProfileSort, person?: string): string {
  switch (sort) {
    case "minutes":
      return "Nada aqui ainda.";
    case "finished":
      return "Nenhum jogo zerado aqui ainda.";
    case "rating":
      return person
        ? `Nada com pelo menos ${MIN_RATED_GAMES} jogos com nota ainda.`
        : `Dê nota a pelo menos ${MIN_RATED_GAMES} jogos de um mesmo item para ele entrar.`;
  }
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function Covers({ row, mode }: { row: ProfileRow; mode: RankingInfo["covers"] }) {
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
