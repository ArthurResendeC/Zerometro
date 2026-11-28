import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { completionTypeLabels, gameStatusLabels } from "@shared/domain";
import { genreLabel } from "@shared/genres";
import type { GroupMemberGame } from "@shared/group";
import type { ProfileRow } from "@shared/profile";
import { GameCover } from "@/components/game-cover";
import { ArrowLeftIcon, PlayIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { memberProfileQuery } from "@/features/group/queries";
import { ProfileAvatar } from "@/features/profile/avatars";
import { formatDate, formatMinutes } from "@/lib/format";

// O perfil público de alguém do grupo: o que está jogando, o que zerou e do que gosta.

export const Route = createFileRoute("/amigo/$handle")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(memberProfileQuery(params.handle.toLowerCase())),
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
  const { data: profile } = useSuspenseQuery(memberProfileQuery(handle.toLowerCase()));
  const { member, totals } = profile;

  const tiles = [
    { label: "Jogado", value: formatMinutes(totals.minutes) },
    { label: "Zerados", value: String(totals.finished) },
    { label: "100%", value: String(totals.fullCompletions) },
    { label: "Conquistas", value: String(totals.achievements) },
    { label: "Ofensiva", value: `${totals.streak} ${totals.streak === 1 ? "dia" : "dias"}` },
    { label: "Na biblioteca", value: String(totals.games) },
  ];

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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.label} className="gap-1">
            <p className="display-xs text-muted-foreground">{tile.label}</p>
            <p className="display-sm">{tile.value}</p>
          </Card>
        ))}
      </div>

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
                g.rating !== null && `★ ${g.rating.toLocaleString("pt-BR")}`,
              ]
                .filter(Boolean)
                .join(" · ")
            }
          />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <TopList title="Gêneros favoritos" rows={profile.genres} label={genreLabel} />
        <TopList title="Séries mais jogadas" rows={profile.series} />
        <TopList title="Desenvolvedoras" rows={profile.developers} />
      </div>
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
            <p className="truncate text-xs text-muted-foreground">{detail(game)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const sameName = (name: string) => name;

function TopList({
  title,
  rows,
  label = sameName,
}: {
  title: string;
  rows: ProfileRow[];
  label?: (name: string) => string;
}) {
  return (
    <Card className="gap-3">
      <h2 className="display-xs text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ainda sem dados.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.key} className="flex justify-between gap-2">
              <span className="truncate">{label(row.name)}</span>
              <span className="shrink-0 text-muted-foreground">{formatMinutes(row.minutes)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
