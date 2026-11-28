import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import {
  type GroupMemberStats,
  type GroupMetric,
  type GroupPeriod,
  groupPeriodLabels,
  groupPeriods,
} from "@shared/group";
import { GameCover } from "@/components/game-cover";
import { PixelFlame, PlayIcon, TrophyIcon } from "@/components/icons";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Card } from "@/components/ui/card";
import { ProfileAvatar } from "@/features/profile/avatars";
import { leaderboardQuery } from "@/features/group/queries";
import { formatMinutes } from "@/lib/format";

// O ranking entre os amigos da instância: horas, zerados, conquistas e ofensiva, por período.

const periodParams = { semana: "week", mes: "month", ano: "year", sempre: "all" } as const;
const metricParams = {
  horas: "minutes",
  zerados: "finished",
  conquistas: "achievements",
  ofensiva: "streak",
} as const;
const invert = <T extends Record<string, string>>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k])) as { [K in keyof T as T[K]]: K };
const periodParamOf = invert(periodParams);
const metricParamOf = invert(metricParams);

const searchSchema = z.object({
  periodo: z.enum(["semana", "mes", "ano", "sempre"]).optional().catch(undefined),
  por: z.enum(["horas", "zerados", "conquistas", "ofensiva"]).optional().catch(undefined),
});

export const Route = createFileRoute("/grupo")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ period: periodParams[search.periodo ?? "mes"] }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(leaderboardQuery(deps.period)),
  component: GroupPage,
});

const metricLabels: Record<GroupMetric, string> = {
  minutes: "Horas",
  finished: "Zerados",
  achievements: "Conquistas",
  streak: "Ofensiva",
};
/** No celular, os quatro só cabem lado a lado abreviados. */
const metricShort: Partial<Record<GroupMetric, string>> = {
  achievements: "Conq.",
  streak: "Ofens.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function metricValue(member: GroupMemberStats, metric: GroupMetric): string {
  switch (metric) {
    case "minutes":
      return formatMinutes(member.minutes);
    case "finished":
      return plural(member.finished, "zerado", "zerados");
    case "achievements":
      return plural(member.achievements, "conquista", "conquistas");
    case "streak":
      return plural(member.streak, "dia", "dias");
  }
}

const medals = ["🥇", "🥈", "🥉"];

function GroupPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const period: GroupPeriod = periodParams[search.periodo ?? "mes"];
  const metric: GroupMetric = metricParams[search.por ?? "horas"];
  const { data: board } = useSuspenseQuery(leaderboardQuery(period));
  // Empates: quem jogou mais horas no período fica na frente.
  const ranked = board.members.toSorted((a, b) => b[metric] - a[metric] || b.minutes - a.minutes);
  const top = Math.max(1, ...ranked.map((m) => m[metric]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display-lg">Grupo</h1>
        <p className="mt-2 text-muted-foreground">
          Quem mais jogou, zerou e conquistou entre os amigos desta instância.
        </p>
      </div>

      {board.meHidden && (
        <Card className="text-sm">
          Você está fora do ranking.{" "}
          <Link to="/ajustes" className="text-info underline">
            Ligue "Aparecer no grupo" nos ajustes
          </Link>{" "}
          para entrar.
        </Card>
      )}

      <Highlights members={board.members} />

      <div className="flex flex-wrap items-start gap-x-2">
        <SegmentedToggle
          legend="Período"
          options={groupPeriods.map((value) => ({ value, label: groupPeriodLabels[value] }))}
          value={period}
          onChange={(value) =>
            navigate({
              search: (s) => ({
                ...s,
                periodo: value === "month" ? undefined : periodParamOf[value],
              }),
              replace: true,
            })
          }
        />
        <SegmentedToggle
          legend="Ordenar por"
          options={(Object.keys(metricLabels) as GroupMetric[]).map((value) => ({
            value,
            label: metricLabels[value],
            short: metricShort[value],
          }))}
          value={metric}
          onChange={(value) =>
            navigate({
              search: (s) => ({
                ...s,
                por: value === "minutes" ? undefined : metricParamOf[value],
              }),
              replace: true,
            })
          }
        />
      </div>

      {ranked.length === 0 ? (
        <Card className="text-muted-foreground">
          Ninguém no grupo ainda. O admin convida amigos nos ajustes.
        </Card>
      ) : (
        <ol className="space-y-3">
          {ranked.map((member, index) => (
            <li key={member.userId}>
              <MemberRow
                member={member}
                position={index + 1}
                metric={metric}
                ratio={member[metric] / top}
                medal={member[metric] > 0 ? medals[index] : undefined}
              />
            </li>
          ))}
        </ol>
      )}
      {metric === "streak" ? (
        <p className="text-xs text-muted-foreground">
          A ofensiva é a de agora (não depende do período), com o mínimo diário de cada um.
        </p>
      ) : metric === "minutes" && period === "all" ? (
        <p className="text-xs text-muted-foreground">
          Em "Sempre", as horas são o total da biblioteca, com o tempo de antes do Zerômetro e o da
          Steam.
        </p>
      ) : null}
    </div>
  );
}

function MemberRow({
  member,
  position,
  metric,
  ratio,
  medal,
}: {
  member: GroupMemberStats;
  position: number;
  metric: GroupMetric;
  ratio: number;
  medal?: string;
}) {
  const details = [
    member.playedDays > 0 && plural(member.playedDays, "dia jogado", "dias jogados"),
    metric !== "finished" && member.finished > 0 && plural(member.finished, "zerado", "zerados"),
    member.fullCompletions > 0 && `${member.fullCompletions}× 100%`,
    metric !== "achievements" &&
      member.achievements > 0 &&
      plural(member.achievements, "conquista", "conquistas"),
    metric !== "streak" && member.streak > 0 && `🔥 ${member.streak}`,
  ].filter(Boolean);

  return (
    <Card className={member.isMe ? "[--px-frame-color:var(--primary)]" : undefined}>
      <div className="flex items-center gap-3">
        <span className="w-8 shrink-0 text-center font-pixel text-sm" aria-label={`${position}º`}>
          {medal ?? `${position}º`}
        </span>
        <ProfileAvatar avatar={member.avatar} className="size-10" />
        <div className="min-w-0 flex-1">
          <Link
            to="/amigo/$handle"
            params={{ handle: member.handle }}
            className="block truncate hover:underline"
          >
            {member.name}{" "}
            <span className="text-sm text-muted-foreground">
              @{member.handle}
              {member.isMe && " (você)"}
            </span>
          </Link>
          {details.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{details.join(" · ")}</p>
          )}
        </div>
        <p className="shrink-0 text-right display-xs">{metricValue(member, metric)}</p>
      </div>
      <div className="h-2 bg-muted" aria-hidden>
        <div className="h-full bg-primary" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      {(member.playingNow || member.topGame || member.rarestAchievement) && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {member.playingNow ? (
            <GameChip
              game={member.playingNow}
              prefix="Jogando agora"
              icon={<PlayIcon className="text-primary" />}
            />
          ) : (
            member.topGame && (
              <GameChip
                game={member.topGame}
                prefix={`Mais jogado (${formatMinutes(member.topGame.minutes)})`}
              />
            )
          )}
          {member.rarestAchievement && (
            <span className="flex items-center gap-1">
              <TrophyIcon className="text-primary" />
              {member.rarestAchievement.title} (
              {member.rarestAchievement.rarity.toLocaleString("pt-BR")}%)
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

function GameChip({
  game,
  prefix,
  icon,
}: {
  game: { igdbId: number; name: string; coverImageId: string | null };
  prefix: string;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      to="/jogo/$igdbId"
      params={{ igdbId: game.igdbId }}
      className="flex min-w-0 items-center gap-2 hover:text-foreground"
    >
      <span className="w-5 shrink-0">
        <GameCover name={game.name} imageId={game.coverImageId} size="cover_small" />
      </span>
      {icon}
      <span className="truncate">
        {prefix}: <span className="text-foreground">{game.name}</span>
      </span>
    </Link>
  );
}

/** Os líderes de cada métrica no período, em cartões pequenos. */
function Highlights({ members }: { members: GroupMemberStats[] }) {
  const leader = (metric: GroupMetric) => {
    const best = members.toSorted((a, b) => b[metric] - a[metric])[0];
    return best && best[metric] > 0 ? best : undefined;
  };
  const tiles: { metric: GroupMetric; title: string; icon: React.ReactNode }[] = [
    { metric: "minutes", title: "Mais jogou", icon: <PlayIcon /> },
    { metric: "finished", title: "Mais zerou", icon: <TrophyIcon /> },
    { metric: "achievements", title: "Mais conquistas", icon: <TrophyIcon /> },
    { metric: "streak", title: "Maior ofensiva", icon: <PixelFlame className="h-4 w-auto" /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {tiles.map(({ metric, title, icon }) => {
        const who = leader(metric);
        return (
          <Card key={metric} className="gap-2">
            <p className="flex items-center gap-2 display-xs text-muted-foreground">
              {icon}
              {title}
            </p>
            {who ? (
              <div className="flex items-center gap-2">
                <ProfileAvatar avatar={who.avatar} />
                <div className="min-w-0">
                  <p className="truncate">{who.name}</p>
                  <p className="text-xs text-muted-foreground">{metricValue(who, metric)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ninguém ainda</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
