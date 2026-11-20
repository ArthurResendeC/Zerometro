import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { safeRedirect, signIn } from "@/lib/auth";
import { authKeys } from "@/lib/queries";

const searchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/entrar")({
  validateSearch: searchSchema,
  component: LoginPage,
});

function failureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "Token incorreto. Confira com quem cuida desta instância.";
  }
  if (error instanceof ApiError) {
    return `O servidor recusou o login (erro ${error.status}). Tente de novo mais tarde.`;
  }
  return "Não deu para falar com o servidor. Confira a conexão e tente de novo.";
}

function LoginPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");

  const login = useMutation({
    mutationFn: signIn,
    onSuccess: async (session) => {
      queryClient.setQueryData(authKeys.session, session);
      router.history.push(safeRedirect(redirect));
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (token.trim()) login.mutate(token.trim());
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
          <div className="space-y-3">
            <Label htmlFor="token">Token de acesso</Label>
            <Input
              id="token"
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              aria-invalid={login.isError || undefined}
              aria-describedby={login.isError ? "login-error" : undefined}
            />
            {login.isError && (
              <p id="login-error" role="alert" className="text-sm text-destructive">
                <span aria-hidden>✕ </span>
                {failureMessage(login.error)}
              </p>
            )}
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={login.isPending || !token.trim()}
          >
            {login.isPending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          O token fica no <code>.env</code> da instância (<code>ZEROMETRO_TOKEN</code>). O acesso
          vale 30 dias neste aparelho.
        </p>
      </Card>
    </main>
  );
}
