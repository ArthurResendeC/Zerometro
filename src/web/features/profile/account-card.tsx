import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type AuthSession, type Avatar, MIN_PASSWORD_LENGTH } from "@shared/auth";
import { LogOutIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetDeviceCache, signOut as endSession } from "@/lib/auth";
import { AvatarPicker, ProfileAvatar } from "./avatars";
import { useChangePassword, useSignOutEverywhere, useUpdateMe } from "./queries";

/** A conta nos Ajustes: nome, avatar, senha e sair (deste aparelho ou de todos). */
export function AccountCard({ session }: { session: AuthSession }) {
  return (
    <Card className="gap-5">
      <div className="space-y-1">
        <Label>👤 Sua conta</Label>
        <p className="text-sm text-muted-foreground">
          É assim que os amigos te veem no grupo.{" "}
          {session.handle && (
            <>
              Você entra com <strong>@{session.handle}</strong>.
            </>
          )}
        </p>
      </div>
      <ProfileForm key={`${session.name}-${session.avatar}`} session={session} />
      <PasswordForm hasPassword={session.hasPassword} />
      <SignOutButtons />
    </Card>
  );
}

function ProfileForm({ session }: { session: AuthSession }) {
  const update = useUpdateMe();
  const [name, setName] = useState(session.name);
  const [avatar, setAvatar] = useState<Avatar>(session.avatar);
  const changed = name.trim() !== session.name || avatar !== session.avatar;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    update.mutate({
      ...(name.trim() !== session.name && { name: name.trim() }),
      ...(avatar !== session.avatar && { avatar }),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-end gap-3">
        <ProfileAvatar avatar={avatar} className="size-12" />
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="profile-name">Nome</Label>
          <Input
            id="profile-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <AvatarPicker value={avatar} onChange={setAvatar} />
      <Button type="submit" disabled={!changed || !name.trim() || update.isPending}>
        {update.isPending ? "Salvando…" : "Salvar perfil"}
      </Button>
    </form>
  );
}

function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setProblem(`A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
      return;
    }
    if (password !== confirm) {
      setProblem("As duas senhas não são iguais");
      return;
    }
    setProblem(null);
    change.mutate(
      { ...(hasPassword && { current }), password },
      {
        onSuccess: () => {
          setCurrent("");
          setPassword("");
          setConfirm("");
        },
        onError: (error) => setProblem(error.message),
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t-2 border-border pt-4">
      <div className="space-y-1">
        <Label>{hasPassword ? "Trocar a senha" : "Definir uma senha"}</Label>
        {!hasPassword && (
          <p className="text-sm text-muted-foreground">
            Hoje você entra com o token da instância. Com uma senha, entra como @owner (o token
            continua valendo para emergências).
          </p>
        )}
      </div>
      {hasPassword && (
        <div className="space-y-2">
          <Label htmlFor="current-password">Senha atual</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="account-new-password">Senha nova</Label>
          <Input
            id="account-new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-confirm-password">Repita</Label>
          <Input
            id="account-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <Button
        type="submit"
        variant="secondary"
        disabled={change.isPending || !password || (hasPassword && !current)}
      >
        {change.isPending ? "Salvando…" : "Salvar senha"}
      </Button>
    </form>
  );
}

function SignOutButtons() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const everywhere = useSignOutEverywhere();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    await endSession().catch(() => {});
    await resetDeviceCache(queryClient);
    await router.navigate({ to: "/entrar" });
  };

  return (
    <div className="space-y-2 border-t-2 border-border pt-4">
      <p className="text-sm text-muted-foreground">
        O acesso vale 30 dias em cada aparelho e se renova sozinho com o uso. "Sair dos outros"
        desconecta também os conectores de IA (é só aprovar de novo).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
          <LogOutIcon /> Sair deste aparelho
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => everywhere.mutate()}
          disabled={everywhere.isPending}
        >
          Sair dos outros aparelhos
        </Button>
      </div>
    </div>
  );
}
