import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import type { LoginInput } from "@shared/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { resetDeviceCache, safeRedirect, signIn } from "@/lib/auth";
import { authKeys } from "@/lib/queries";

const searchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/entrar")({
  validateSearch: searchSchema,
  component: LoginPage,
});

type Mode = "password" | "token";

function failureMessage(error: unknown, mode: Mode): string {
  if (error instanceof ApiError && error.status === 401) {
    return mode === "token"
      ? "Token incorreto. Ele fica no .env da instância (ZEROMETRO_TOKEN)."
      : "@apelido ou senha incorretos. Esqueceu a senha? Peça um link novo para quem te convidou.";
  }
  if (error instanceof ApiError && error.status === 429) return error.message;
  if (error instanceof ApiError) {
    return `O servidor recusou o login (erro ${error.status}). Tente de novo mais tarde.`;
  }
  return "Não deu para falar com o servidor. Confira a conexão e tente de novo.";
}

function LoginPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("password");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");

  const login = useMutation({
    mutationFn: signIn,
    onSuccess: async (session) => {
      // Outro perfil pode ter usado este aparelho: começa com o cache limpo.
      await resetDeviceCache(queryClient);
      queryClient.setQueryData(authKeys.session, session);
      router.history.push(safeRedirect(redirect));
    },
  });

  const input: LoginInput | null =
    mode === "token"
      ? token.trim()
        ? { token: token.trim() }
        : null
      : handle.trim() && password
        ? { handle: handle.trim().replace(/^@/, ""), password }
        : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (input) login.mutate(input);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    login.reset();
  };

  const errorProps = {
    "aria-invalid": login.isError || undefined,
    "aria-describedby": login.isError ? "login-error" : undefined,
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md items-center gap-6 p-8 text-center pixel-drop">
        <div className="space-y-3">
          <h1 className="display-lg">
            Zer<span className="text-primary">ô</span>metro
          </h1>
          <p className="text-muted-foreground">Seu backlog de jogos e o tempo que você joga.</p>
        </div>
        <form onSubmit={submit} className="flex w-full flex-col gap-5 text-left">
          {mode === "password" ? (
            <>
              <div className="space-y-3">
                <Label htmlFor="handle">@apelido</Label>
                <Input
                  id="handle"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  {...errorProps}
                />
              </div>
              <div className="space-y-3">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  {...errorProps}
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <Label htmlFor="token">Token da instância</Label>
              <Input
                id="token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                {...errorProps}
              />
            </div>
          )}
          {login.isError && (
            <p id="login-error" role="alert" className="text-sm text-destructive">
              <span aria-hidden>✕ </span>
              {failureMessage(login.error, mode)}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={login.isPending || !input}>
            {login.isPending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Ainda não tem perfil? Peça um convite para quem cuida desta instância. O acesso vale 30
            dias neste aparelho.
          </p>
          <button
            type="button"
            className="underline underline-offset-4 hover:text-foreground"
            onClick={() => switchMode(mode === "password" ? "token" : "password")}
          >
            {mode === "password"
              ? "Sou o admin: entrar com o token"
              : "Entrar com @apelido e senha"}
          </button>
        </div>
      </Card>
    </main>
  );
}
