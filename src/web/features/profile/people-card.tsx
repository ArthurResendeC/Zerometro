import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { CreatedInvite, InviteSummary, UserSummary } from "@shared/auth";
import { PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { ProfileAvatar } from "./avatars";
import {
  adminInvitesQuery,
  adminUsersQuery,
  useCreateInvite,
  useCreateResetLink,
  useRevokeInvite,
  useSetUserDisabled,
} from "./queries";

/** Só o admin: quem está na instância, convidar amigos e gerar links de senha nova. */
export function PeopleCard() {
  const [link, setLink] = useState<{ title: string; invite: CreatedInvite } | null>(null);

  return (
    <Card className="gap-5">
      <div className="space-y-1">
        <Label>🕹️ Pessoas</Label>
        <p className="text-sm text-muted-foreground">
          Convide amigos para terem o próprio perfil nesta instância. Cada convite é um link que
          vale uma vez, por 7 dias. Todo mundo aqui aparece no ranking do grupo (quem não quiser
          desliga nos ajustes dele).
        </p>
      </div>
      <InviteForm onCreated={(invite) => setLink({ title: "Convite criado", invite })} />
      {link && <LinkBox {...link} onClose={() => setLink(null)} />}
      <UsersList
        onResetLink={(user, invite) =>
          setLink({ title: `Link de senha nova para ${user.name}`, invite })
        }
      />
      <PendingInvites />
    </Card>
  );
}

function InviteForm({ onCreated }: { onCreated: (invite: CreatedInvite) => void }) {
  const create = useCreateInvite();
  const [note, setNote] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate(
      { note: note.trim() || undefined },
      {
        onSuccess: (invite) => {
          setNote("");
          onCreated(invite);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Label htmlFor="invite-note">Para quem é? (opcional)</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="invite-note"
          value={note}
          maxLength={60}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: João da faculdade"
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={create.isPending}>
          <PlusIcon /> {create.isPending ? "Criando…" : "Criar convite"}
        </Button>
      </div>
    </form>
  );
}

/** O link recém-criado: o código só aparece agora, então dá para copiar ou compartilhar. */
function LinkBox({
  title,
  invite,
  onClose,
}: {
  title: string;
  invite: CreatedInvite;
  onClose: () => void;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
      toast.success("Link copiado");
    } catch {
      toast.error("Não deu para copiar: selecione o link e copie à mão");
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "Zerômetro", text: "Entra no Zerômetro!", url: invite.url });
    } catch {
      // cancelado
    }
  };
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="space-y-2 bg-muted p-3" aria-live="polite">
      <p className="text-sm font-semibold">{title}</p>
      <Input readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} />
      <p className="text-xs text-muted-foreground">
        Vale uma vez, até {formatDate(invite.expiresAt.slice(0, 10))}. Depois de fechar, não dá para
        ver o link de novo (só criar outro).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          Copiar link
        </Button>
        {canShare && (
          <Button size="sm" variant="secondary" onClick={share}>
            Compartilhar
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

function UsersList({
  onResetLink,
}: {
  onResetLink: (user: UserSummary, invite: CreatedInvite) => void;
}) {
  const { data: users } = useQuery(adminUsersQuery());
  const setDisabled = useSetUserDisabled();
  const resetLink = useCreateResetLink();

  if (!users) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Perfis ({users.length})</p>
      <ul className="divide-y-(length:--rule) divide-border">
        {users.map((user) => (
          <li key={user.userId} className="flex flex-wrap items-center gap-3 py-2">
            <ProfileAvatar avatar={user.avatar} />
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {user.name}{" "}
                <span className="text-sm text-muted-foreground">
                  @{user.handle ?? "sem-apelido"}
                </span>
                {user.role === "admin" && <span className="ml-2 text-xs text-primary">admin</span>}
                {user.disabled && <span className="ml-2 text-xs text-destructive">suspenso</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {user.lastPlayedOn
                  ? `Jogou por último em ${formatDate(user.lastPlayedOn)}`
                  : "Ainda sem sessões"}
              </p>
            </div>
            {user.role !== "admin" && (
              <div className="flex gap-1">
                {!user.disabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={resetLink.isPending}
                    onClick={() =>
                      resetLink.mutate(user.userId, {
                        onSuccess: (invite) => onResetLink(user, invite),
                      })
                    }
                  >
                    Senha nova
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={setDisabled.isPending}
                  onClick={() =>
                    setDisabled.mutate({ userId: user.userId, disabled: !user.disabled })
                  }
                >
                  {user.disabled ? "Reativar" : "Suspender"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const describe = (invite: InviteSummary) =>
  invite.kind === "reset"
    ? `Senha nova para ${invite.user?.name ?? "alguém"}`
    : invite.note || "Convite sem nota";

function PendingInvites() {
  const { data: invites } = useQuery(adminInvitesQuery());
  const revoke = useRevokeInvite();
  const pending = invites?.filter((invite) => invite.status === "pending") ?? [];

  if (pending.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Links ainda não usados</p>
      <ul className="divide-y-(length:--rule) divide-border">
        {pending.map((invite) => (
          <li key={invite.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate">{describe(invite)}</p>
              <p className="text-xs text-muted-foreground">
                Vence em {formatDate(invite.expiresAt.slice(0, 10))}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(invite.id)}
            >
              Revogar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
