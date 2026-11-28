import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { completionTypeLabels, gameStatusLabels } from "@shared/domain";
import type { GroupMemberGame, GroupMemberProfile } from "@shared/group";
import {
  type GroupSection,
  type GroupTab,
  groupTabLabels,
  groupTabs,
  tabOfSection,
} from "@shared/group-sections";
import type { ProfileSort } from "@shared/profile";
import { GameCover } from "@/components/game-cover";
import { ArrowLeftIcon, PlayIcon } from "@/components/icons";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CriteriaCard,
  ProfileSortToggle,
  RankingCard,
  rankings,
  sortParamOf,
  sortParams,
} from "@/features/gamer-profile/profile-cards";
import {
  memberGamerProfileQuery,
  memberProfileQuery,
  memberStatsQuery,
} from "@/features/group/queries";
import { ProfileAvatar } from "@/features/profile/avatars";
import { ActivityHeatmap } from "@/features/stats/activity-heatmap";
import { GamesCard, GenresCard } from "@/features/stats/breakdown-cards";
import { PurchasesSection } from "@/features/stats/purchases-section";
import { RecordsSection } from "@/features/stats/records-section";
import { RhythmSection } from "@/features/stats/rhythm-section";
import { TimelineSection } from "@/features/stats/timeline-section";
import { formatDate, formatMinutes } from "@/lib/format";

// O perfil público de alguém do grupo, em abas: o resumo (o que está jogando, o que zerou, as
// notas), as estatísticas e o perfil de gamer. Cada um escolhe nos Ajustes o que aparece aqui;
// o servidor nem manda o resto.

/** As abas no endereço, em português (?aba=estatisticas). */
const tabParams = { resumo: "summary", estatisticas: "stats", perfil: "profile" } as const;
type TabParam = keyof typeof tabParams;
const tabParamOf = Object.fromEntries(
  Object.entries(tabParams).map(([param, tab]) => [tab, param]),
) as Record<GroupTab, TabParam>;

/** Notas mostradas antes do "Ver todas". */
const RATINGS_SHOWN = 18;

const searchSchema = z.object({
  aba: z.enum(["resumo", "estatisticas", "perfil"]).optional().catch(undefined),
  /** Ano das estatísticas; sem ano, os últimos 12 meses. */
  ano: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  por: z.enum(["horas", "zerados", "nota"]).optional().catch(undefined),
});

/** As abas com alguma seção compartilhada, na ordem da tela. */
function availableTabs(sections: GroupSection[]): GroupTab[] {
  const used = new Set(sections.map((section) => tabOfSection[section]));
  return groupTabs.filter((tab) => used.has(tab));
}

/** A aba pedida, se a pessoa compartilha algo nela; senão, a primeira que tiver. */
function pickTab(sections: GroupSection[], asked: TabParam | undefined): GroupTab | null {
  const tabs = availableTabs(sections);
  const wanted = asked && tabParams[asked];
  return wanted && tabs.includes(wanted) ? wanted : (tabs[0] ?? null);
}

export const Route = createFileRoute("/amigo/$handle")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ aba: search.aba, year: search.ano }),
  loader: async ({ context, params, deps }) => {
    const handle = params.handle.toLowerCase();
    const profile = await context.queryClient.ensureQueryData(memberProfileQuery(handle));
    const tab = pickTab(profile.sections, deps.aba);
    if (tab === "stats")
      await context.queryClient.ensureQueryData(memberStatsQuery(handle, deps.year));
    if (tab === "profile")
      await context.queryClient.ensureQueryData(memberGamerProfileQuery(handle));
  },
  component: FriendPage,
  errorComponent: () => (
    <div className="space-y-4">
      <p>Essa pessoa não está no grupo (ou saiu do ranking).</p>
      <Link to="/grupo" className="text-info underline">
        Voltar para o grupo
      </Link>
    </div>
  ),
});

function FriendPage() {
  const { handle } = Route.useParams();
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: profile } = useSuspenseQuery(memberProfileQuery(handle.toLowerCase()));
  const { member } = profile;
  const tabs = availableTabs(profile.sections);
  const tab = pickTab(profile.sections, aba);

  return (
    <div className="space-y-6">
      <Link
        to="/grupo"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon /> Grupo
      </Link>
      <div className="flex items-center gap-4">
        <ProfileAvatar avatar={member.avatar} className="size-16" />
        <div className="min-w-0">
          <h1 className="display-lg truncate">{member.name}</h1>
          <p className="text-muted-foreground">
            @{member.handle}
            {member.isMe && " (você)"}
          </p>
        </div>
      </div>

      {member.isMe && (
        <p className="text-sm text-muted-foreground">
          É assim que os amigos veem o seu perfil. Escolha o que aparece em{" "}
          <Link to="/ajustes" className="text-info underline">
            Ajustes
          </Link>
          .
        </p>
      )}

      {profile.playingNow && (
        <Card className="flex-row items-center gap-3">
          <PlayIcon className="text-primary" />
          <span>
            Jogando agora:{" "}
            <Link
              to="/jogo/$igdbId"
              params={{ igdbId: profile.playingNow.igdbId }}
              className="underline"
            >
              {profile.playingNow.name}
            </Link>
          </span>
        </Card>
      )}

      {tab === null ? (
        <p className="text-muted-foreground">
          {member.name} não compartilha nada além do ranking do grupo.
        </p>
      ) : (
        <>
          {tabs.length > 1 && (
            <SegmentedToggle
              legend="Seção do perfil"
              options={tabs.map((value) => ({
                value,
                label: groupTabLabels[value],
                short: value === "profile" ? "Perfil" : undefined,
              }))}
              value={tab}
              onChange={(value) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    aba: value === tabs[0] ? undefined : tabParamOf[value],
                  }),
                  replace: true,
                })
              }
            />
          )}
          {tab === "summary" && <SummaryTab profile={profile} />}
          {tab === "stats" && <StatsTab handle={member.handle} person={member.name} />}
          {tab === "profile" && <GamerProfileTab handle={member.handle} person={member.name} />}
        </>
      )}
    </div>
  );
}

function SummaryTab({ profile }: { profile: GroupMemberProfile }) {
  const { totals } = profile;
  const tiles = totals && [
    { label: "Jogado", value: formatMinutes(totals.minutes) },
    { label: "Zerados", value: String(totals.finished) },
    { label: "100%", value: String(totals.fullCompletions) },
    { label: "Conquistas", value: String(totals.achievements) },
    { label: "Ofensiva", value: `${totals.streak} ${totals.streak === 1 ? "dia" : "dias"}` },
    { label: "Na biblioteca", value: String(totals.games) },
  ];

  return (
    <div className="space-y-6">
      {tiles && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((tile) => (
            <Card key={tile.label} className="gap-1">
              <p className="display-xs text-muted-foreground">{tile.label}</p>
              <p className="display-sm">{tile.value}</p>
            </Card>
          ))}
        </div>
      )}

      {profile.playing && (
        <section className="space-y-3">
          <h2 className="display-sm">Jogando</h2>
          {profile.playing.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada em andamento.</p>
          ) : (
            <GameGrid
              games={profile.playing}
              keyOf={(g) => String(g.igdbId)}
              detail={(g) => formatMinutes(g.minutesPlayed)}
            />
          )}
        </section>
      )}

      {profile.recentlyFinished && (
        <section className="space-y-3">
          <h2 className="display-sm">Zerou por último</h2>
          {profile.recentlyFinished.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conclusão ainda.</p>
          ) : (
            <GameGrid
              games={profile.recentlyFinished}
              keyOf={(g) => `${g.igdbId}-${g.type}-${g.completedOn}`}
              detail={(g) =>
                [
                  completionTypeLabels[g.type],
                  formatDate(g.completedOn),
                  g.rating !== null && `★ ${formatRating(g.rating)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
            />
          )}
        </section>
      )}

      {profile.ratings && <RatingsSection ratings={profile.ratings} />}
    </div>
  );
}

const formatRating = (rating: number) =>
  rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** A nota de cada jogo, da maior para a menor. */
function RatingsSection({ ratings }: { ratings: GroupMemberGame[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? ratings : ratings.slice(0, RATINGS_SHOWN);
  return (
    <section className="space-y-3">
      <h2 className="display-sm">Notas</h2>
      {ratings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum jogo com nota ainda.</p>
      ) : (
        <>
          <GameGrid
            games={shown}
            keyOf={(g) => String(g.igdbId)}
            detail={(g) => `★ ${formatRating(g.rating!)} · ${gameStatusLabels[g.status]}`}
          />
          {ratings.length > RATINGS_SHOWN && (
            <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Mostrar menos" : `Ver todas as ${ratings.length} notas`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function StatsTab({ handle, person }: { handle: string; person: string }) {
  const { ano: year } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: stats } = useSuspenseQuery(memberStatsQuery(handle, year));

  return (
    <div className="space-y-6">
      <NativeSelect
        aria-label="Período"
        value={year ?? ""}
        onChange={(e) =>
          navigate({
            search: (prev) => ({
              ...prev,
              ano: e.target.value ? Number(e.target.value) : undefined,
            }),
            replace: true,
          })
        }
        className="w-52"
      >
        <option value="">Últimos 12 meses</option>
        {stats.years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </NativeSelect>

      {stats.heatmap && <ActivityHeatmap key={year ?? "rolling"} heatmap={stats.heatmap} />}

      {stats.breakdown && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
          <GenresCard breakdown={stats.breakdown} />
          <GamesCard breakdown={stats.breakdown} />
        </div>
      )}

      {stats.timeline && <TimelineSection timeline={stats.timeline} person={person} />}
      {stats.rhythm && <RhythmSection rhythm={stats.rhythm} person={person} />}
      {stats.records && <RecordsSection records={stats.records} />}
      {stats.purchases && <PurchasesSection purchases={stats.purchases} person={person} />}
    </div>
  );
}

function GamerProfileTab({ handle, person }: { handle: string; person: string }) {
  const { por } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: profile } = useSuspenseQuery(memberGamerProfileQuery(handle));
  const asked: ProfileSort = sortParams[por ?? "horas"];
  // Sem as notas compartilhadas, não há como ordenar por nota.
  const sort = asked === "rating" && !profile.ratingsShared ? "minutes" : asked;
  const shown = rankings.flatMap((info) => {
    const rows = profile[info.section];
    return rows ? [{ info, rows }] : [];
  });

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        {profile.gamesCounted === 0
          ? `O gosto de ${person} aparece aqui quando jogar ou zerar alguns jogos.`
          : `O gosto de ${person} pelos ${profile.gamesCounted} ${profile.gamesCounted === 1 ? "jogo" : "jogos"} que jogou ou zerou (${formatMinutes(profile.totalMinutes)} no total).`}
      </p>

      {profile.criteria && profile.criteria.length > 0 && (
        <CriteriaCard criteria={profile.criteria} person={person} />
      )}

      {shown.length > 0 && (
        <>
          <ProfileSortToggle
            value={sort}
            withRating={profile.ratingsShared}
            onChange={(value) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  por: value === "minutes" ? undefined : sortParamOf[value],
                }),
                replace: true,
              })
            }
          />
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
            {shown.map(({ info, rows }) => (
              <RankingCard key={info.section} info={info} rows={rows} sort={sort} person={person} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GameGrid<T extends GroupMemberGame>({
  games,
  detail,
  keyOf,
}: {
  games: T[];
  detail: (game: T) => string;
  /** Um jogo pode aparecer mais de uma vez (replays): a chave diz qual. */
  keyOf: (game: T) => string;
}) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {games.map((game) => (
        <li key={keyOf(game)}>
          <Link
            to="/jogo/$igdbId"
            params={{ igdbId: game.igdbId }}
            className="block space-y-1"
            title={`${game.name} (${gameStatusLabels[game.status]})`}
          >
            <GameCover name={game.name} imageId={game.coverImageId} />
            <p className="truncate text-sm">{game.name}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{detail(game)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
