import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { linkSteamProfileSchema, type SteamAutoSyncState, type SteamProfile } from "@shared/steam";
import { ExternalLink } from "@/components/external-link";
import { DownloadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import {
  steamProfileQuery,
  useLinkSteamProfile,
  useSyncSteamLibrary,
  useUnlinkSteamProfile,
} from "@/lib/queries";

/**
 * Perfil da Steam nos Ajustes: conectar (URL ou SteamID64), sincronizar a biblioteca inteira e
 * desconectar. Some se a instância não tem a chave da Steam.
 */
export function SteamSettingsCard() {
  const { data } = useQuery(steamProfileQuery());
  if (!data?.enabled) return null;

  return (
    <Card className="gap-4">
      <div className="space-y-1">
        <Label>🎮 Steam</Label>
        <p className="text-sm text-muted-foreground">
          Traga as conquistas que você já desbloqueou e as horas de cada jogo. Nada é marcado como
          não feito, e o tempo da Steam só vale no jogo em que você escolher usá-lo.
        </p>
      </div>
      {data.profile ? <LinkedProfile profile={data.profile} auto={data.auto} /> : <LinkForm />}
    </Card>
  );
}

function LinkForm() {
  const link = useLinkSteamProfile();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = linkSteamProfileSchema.safeParse({ profile: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Perfil inválido");
      return;
    }
    setError(null);
    link.mutate(parsed.data);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Label htmlFor="steam-profile">Perfil da Steam</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="steam-profile"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="steamcommunity.com/id/seu-nome"
          className="min-w-0 flex-1"
          aria-invalid={error !== null}
          aria-describedby="steam-profile-help"
        />
        <Button type="submit" disabled={link.isPending}>
          Conectar
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p id="steam-profile-help" className="text-xs text-muted-foreground">
        A URL do seu perfil ou o SteamID64. Sem senha: o Zerômetro só lê o que é público, então em
        Editar perfil → Privacidade deixe "Detalhes dos jogos" como Público.
      </p>
    </form>
  );
}

function LinkedProfile({
  profile,
  auto,
}: {
  profile: SteamProfile;
  auto: SteamAutoSyncState | null;
}) {
  const sync = useSyncSteamLibrary();
  const unlink = useUnlinkSteamProfile();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {profile.avatarUrl && (
          <img
            src={profile.avatarUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 border-2 border-border"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-6">{profile.name}</p>
          <p className="text-sm text-muted-foreground">
            <ExternalLink href={profile.profileUrl}>Ver perfil</ExternalLink> · conectado em{" "}
            {formatDate(profile.linkedAt.slice(0, 10))}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          <DownloadIcon /> {sync.isPending ? "Sincronizando…" : "Sincronizar tudo"}
        </Button>
        <Button variant="ghost" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
          Desconectar
        </Button>
      </div>
      <AutoSyncStatus auto={auto} />
      <p className="text-xs text-muted-foreground">
        "Sincronizar tudo" passa pelos jogos da biblioteca que estão na sua conta, um de cada vez.
        Para um jogo só, use o botão na página dele.
      </p>
    </div>
  );
}

const dayAndTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Quando a sincronização automática rodou por último e, se falhou, por quê. */
function AutoSyncStatus({ auto }: { auto: SteamAutoSyncState | null }) {
  return (
    <div className="space-y-1 text-sm" aria-live="polite">
      <p className="text-muted-foreground">
        Sincroniza sozinho quando você abre o app (no máximo a cada 30 min), só nos jogos que você
        jogou desde a última vez.
        {auto && !auto.lastError && <> Última: {dayAndTime(auto.lastRunAt)}.</>}
      </p>
      {auto?.lastError && (
        <p className="text-destructive">
          A última sincronização automática ({dayAndTime(auto.lastError.at)}) falhou:{" "}
          {auto.lastError.message}.
        </p>
      )}
    </div>
  );
}
