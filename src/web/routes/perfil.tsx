import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { ProfileSort } from "@shared/profile";
import {
  CriteriaCard,
  ProfileSortToggle,
  RankingCard,
  rankings,
  sortParamOf,
  sortParams,
} from "@/features/gamer-profile/profile-cards";
import { formatMinutes } from "@/lib/format";
import { profileQuery } from "@/lib/queries";

const searchSchema = z.object({
  por: z.enum(["horas", "zerados", "nota"]).optional().catch(undefined),
});

export const Route = createFileRoute("/perfil")({
  validateSearch: searchSchema,
  loader: ({ context }) => context.queryClient.ensureQueryData(profileQuery()),
  component: ProfilePage,
});

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

      {profile.criteria.length > 0 && <CriteriaCard criteria={profile.criteria} />}

      <ProfileSortToggle
        value={sort}
        onChange={(value) =>
          navigate({
            search: { por: value === "minutes" ? undefined : sortParamOf[value] },
            replace: true,
          })
        }
      />

      <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
        {rankings.map((info) => (
          <RankingCard key={info.section} info={info} rows={profile[info.section]} sort={sort} />
        ))}
      </div>
    </div>
  );
}
