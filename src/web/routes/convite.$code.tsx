import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  type AcceptSignupInput,
  acceptResetSchema,
  acceptSignupSchema,
  type AuthSession,
  type Avatar,
  DEFAULT_AVATAR,
  type InvitePreview,
} from "@shared/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarPicker, ProfileAvatar } from "@/features/profile/avatars";
import { invitePreviewQuery } from "@/features/profile/queries";
import { api, ApiError, unwrap } from "@/lib/api";
import { resetDeviceCache } from "@/lib/auth";
import { authKeys } from "@/lib/queries";

// Link que o admin manda: criar o perfil (convite) ou definir uma senha nova (redefinição).
// Público: abre sem login, e quem já estava logado neste aparelho passa para o perfil novo.

export const Route = createFileRoute("/convite/$code")({
  component: InvitePage,
});

function InvitePage() {
  const { code } = Route.useParams();
  const preview = useQuery(invitePreviewQuery(code));

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md gap-6 p-8 pixel-drop">
        <h1 className="display-lg text-center">
          Zer<span className="text-primary">ô</span>metro
        </h1>
        {preview.isPending ? (
          <p className="text-center text-muted-foreground">Abrindo o convite…</p>
        ) : preview.isError ? (
          <InvalidInvite error={preview.error} />
        ) : preview.data.kind === "signup" ? (
          <SignupForm code={code} preview={preview.data} />
        ) : (
          <ResetForm code={code} preview={preview.data} />
        )}
      </Card>
    </main>
  );
}

function InvalidInvite({ error }: { error: Error }) {
  const gone = error instanceof ApiError && error.status === 410;
  return (
    <div className="space-y-4 text-center">
      <p role="alert">
        {gone ? error.message : "Não deu para abrir o convite. Confira a conexão e tente de novo."}
      </p>
      <Link to="/entrar" className="text-sm underline underline-offset-4">
        Já tenho perfil: entrar
      </Link>
    </div>
  );
}

/** Depois de aceitar: o cookie já é do perfil; limpa o que for de outro e vai para o início. */
function useEnter() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async (session: AuthSession) => {
    await resetDeviceCache(queryClient);
    queryClient.setQueryData(authKeys.session, session);
    await router.navigate({ to: "/" });
  };
}

function SignupForm({
  code,
  preview,
}: {
  code: string;
  preview: Extract<InvitePreview, { kind: "signup" }>;
}) {
  const enter = useEnter();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [avatar, setAvatar] = useState<Avatar>(DEFAULT_AVATAR);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: (json: AcceptSignupInput) =>
      unwrap(api.auth.invites[":code"].signup.$post({ param: { code }, json })),
    onSuccess: enter,
    onError: (error) => setProblem(error.message),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setProblem("As duas senhas não são iguais");
      return;
    }
    const parsed = acceptSignupSchema.safeParse({
      name,
      handle: handle.replace(/^@/, ""),
      avatar,
      password,
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Confira os campos");
      return;
    }
    setProblem(null);
    accept.mutate(parsed.data);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="space-y-1 text-center">
        <p className="text-lg">
          <strong>{preview.invitedBy}</strong> te convidou!
        </p>
        <p className="text-sm text-muted-foreground">
          Crie o seu perfil para registrar o que você joga e comparar com o grupo.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <ProfileAvatar avatar={avatar} className="size-16" />
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Avatar</Label>
        <AvatarPicker value={avatar} onChange={setAvatar} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="handle">@apelido</Label>
        <Input
          id="handle"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          aria-describedby="handle-help"
        />
        <p id="handle-help" className="text-xs text-muted-foreground">
          É com ele que você entra e que os amigos te acham. De 3 a 20 letras sem acento, números ou
          _.
        </p>
      </div>
      <PasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          <span aria-hidden>✕ </span>
          {problem}
        </p>
      )}
      <Button type="submit" size="lg" disabled={accept.isPending}>
        {accept.isPending ? "Criando…" : "Criar perfil"}
      </Button>
    </form>
  );
}

function ResetForm({
  code,
  preview,
}: {
  code: string;
  preview: Extract<InvitePreview, { kind: "reset" }>;
}) {
  const enter = useEnter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: (json: { password: string }) =>
      unwrap(api.auth.invites[":code"].reset.$post({ param: { code }, json })),
    onSuccess: enter,
    onError: (error) => setProblem(error.message),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setProblem("As duas senhas não são iguais");
      return;
    }
    const parsed = acceptResetSchema.safeParse({ password });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Senha inválida");
      return;
    }
    setProblem(null);
    accept.mutate(parsed.data);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="space-y-1 text-center">
        <p className="text-lg">
          Senha nova para <strong>{preview.name}</strong> (@{preview.handle})
        </p>
        <p className="text-sm text-muted-foreground">
          Os aparelhos e conectores que estavam conectados vão pedir para entrar de novo.
        </p>
      </div>
      <PasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          <span aria-hidden>✕ </span>
          {problem}
        </p>
      )}
      <Button type="submit" size="lg" disabled={accept.isPending}>
        {accept.isPending ? "Salvando…" : "Salvar senha e entrar"}
      </Button>
    </form>
  );
}

function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="new-password">Senha</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          aria-describedby="password-help"
        />
        <p id="password-help" className="text-xs text-muted-foreground">
          Pelo menos 8 caracteres.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Repita a senha</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
        />
      </div>
    </>
  );
}
