import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { completionTypeLabels, gameStatusLabels } from "@shared/domain";
import type { GroupGameEntry } from "@shared/group";
import { Card } from "@/components/ui/card";
import { ProfileAvatar } from "@/features/profile/avatars";
import { formatMinutes } from "@/lib/format";
import { gameInGroupQuery } from "./queries";

/** Quem do grupo tem este jogo e como está com ele. Some se só você tem. */
export function GameInGroup({ igdbId }: { igdbId: number }) {
  const { data } = useQuery(gameInGroupQuery(igdbId));
  if (!data || !data.some((entry) => !entry.member.isMe)) return null;

  // Numa seção: o `m-1` do Card não pode anular o espaçamento da página.
  return (
    <section>
      <Card className="gap-3">
        <h2 className="display-xs text-muted-foreground">No grupo</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((entry) => (
            <li key={entry.member.userId}>
              <Link
                to="/amigo/$handle"
                params={{ handle: entry.member.handle }}
                className="flex items-center gap-3 p-1 hover:bg-accent"
              >
                <ProfileAvatar avatar={entry.member.avatar} />
                <div className="min-w-0">
                  <p className="truncate">
                    {entry.member.name}
                    {entry.member.isMe && <span className="text-muted-foreground"> (você)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{summary(entry)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function summary(entry: GroupGameEntry): string {
  return [
    entry.completion ? completionTypeLabels[entry.completion.best] : gameStatusLabels[entry.status],
    entry.minutesPlayed > 0 && formatMinutes(entry.minutesPlayed),
    entry.achievements &&
      entry.achievements.total > 0 &&
      `🏆 ${entry.achievements.unlocked}/${entry.achievements.total}`,
    entry.rating !== null && `★ ${entry.rating.toLocaleString("pt-BR")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
