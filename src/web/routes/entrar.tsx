import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient, safeRedirect } from "@/lib/auth-client";

const searchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
  /** Erro devolvido pela Better Auth no callback do Google. */
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/entrar")({
  validateSearch: searchSchema,
  component: LoginPage,
});

function errorMessage(code: string): string {
  // not_invited vem do hook de convidados no servidor; access_denied, do "Cancelar" no Google.
  if (code === "not_invited" || code === "unable_to_create_user") {
    return "Esse e-mail não está na lista de convidados. Peça um convite ao dono do Zerômetro.";
  }
  if (code === "access_denied") return "Login cancelado.";
  return "Não deu para entrar. Tente de novo.";
}

function LoginPage() {
  const { redirect, error } = Route.useSearch();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const signIn = async () => {
    setPending(true);
    setFailure(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: safeRedirect(redirect),
      errorCallbackURL: "/entrar",
    });
    // Em caso de sucesso o navegador já está indo para o Google.
    if (result.error) {
      setPending(false);
      setFailure(
        result.error.status
          ? `O servidor recusou o login (erro ${result.error.status}). Tente de novo mais tarde.`
          : "Não deu para falar com o servidor. Confira a conexão e tente de novo.",
      );
    }
  };

  const message = failure ?? (error && errorMessage(error));

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm space-y-6 p-6 text-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Zerô<span className="text-brand">metro</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Seu backlog de jogos e o tempo que você joga.
          </p>
        </div>
        <Button className="w-full" size="lg" onClick={signIn} disabled={pending}>
          <GoogleIcon /> {pending ? "Abrindo o Google…" : "Entrar com Google"}
        </Button>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Acesso só para convidados.</p>
      </Card>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
