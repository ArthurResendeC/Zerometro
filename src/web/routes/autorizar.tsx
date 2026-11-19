import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { authClient, isOAuthFlow } from "@/lib/auth-client";

// Consentimento do fluxo OAuth: um cliente MCP (ex.: conector do Claude) pede para usar o
// Zerômetro em nome do usuário. A query assinada pelo servidor fica na URL; o
// oauthProviderClient a manda junto do POST de consentimento.

const searchSchema = z.looseObject({
  client_id: z.string().optional().catch(undefined),
  scope: z.string().optional().catch(undefined),
  redirect_uri: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/autorizar")({
  validateSearch: searchSchema,
  component: ConsentPage,
});

/** O que cada escopo OAuth libera, em português (openid é implícito: saber quem é você). */
const scopeLabels: Record<string, string> = {
  profile: "Ver seu nome e sua foto",
  email: "Ver seu e-mail",
  offline_access: "Continuar conectado sem pedir login de novo",
};

const publicClientQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["oauth", "client", clientId],
    queryFn: async () => {
      const { data, error } = await authClient.oauth2.publicClient({
        query: { client_id: clientId },
      });
      if (error) throw new Error(error.message ?? "Aplicativo não encontrado");
      return data;
    },
    staleTime: Infinity,
    retry: false,
  });

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

function ConsentPage() {
  const search = Route.useSearch();
  const { session } = Route.useRouteContext();
  const clientId = search.client_id ?? "";
  const client = useQuery({ ...publicClientQuery(clientId), enabled: isOAuthFlow(search) });
  const [pending, setPending] = useState<"accept" | "deny" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!isOAuthFlow(search) || client.isError) {
    return (
      <Shell>
        <h1 className="display-md">Link inválido</h1>
        <p className="text-muted-foreground">
          Este pedido de autorização não é válido ou expirou. Volte ao aplicativo e tente conectar
          de novo.
        </p>
      </Shell>
    );
  }

  const name = client.data?.client_name || "Um aplicativo";
  const returnHost = hostOf(search.redirect_uri);
  const scopes = (search.scope ?? "").split(" ").filter((scope) => scope in scopeLabels);

  const decide = async (accept: boolean) => {
    setPending(accept ? "accept" : "deny");
    setFailure(null);
    const { data, error } = await authClient.oauth2.consent({ accept });
    if (error || !data?.url) {
      setPending(null);
      setFailure(
        error?.status === 400
          ? "Este pedido expirou. Volte ao aplicativo e tente conectar de novo."
          : "Não deu para concluir. Tente de novo.",
      );
      return;
    }
    // Volta para o aplicativo (com o código, ou com access_denied). Para http(s) o próprio
    // authClient já navega (plugin de redirect); navegar de novo entregaria o código duas vezes.
    // Esquemas próprios de apps (ex.: cursor://) ele recusa, então seguimos aqui.
    if (!/^https?:/i.test(data.url)) window.location.assign(data.url);
  };

  return (
    <Shell>
      <div className="space-y-3">
        <h1 className="display-md">Autorizar acesso</h1>
        {client.isPending ? (
          <Skeleton className="mx-auto h-6 w-56" />
        ) : (
          <p className="text-lg leading-6">
            <strong className="text-primary">{name}</strong> quer usar o seu Zerômetro
          </p>
        )}
        {session && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <UserAvatar user={session.user} className="size-6" />
            <span className="truncate">{session.user.email}</span>
          </div>
        )}
      </div>

      <div className="w-full space-y-2 text-left">
        <p className="display-xs">Ele vai poder:</p>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2">
            <CheckIcon className="mt-0.5 text-primary" />
            Ver e alterar sua biblioteca, suas sessões, o timer e as estatísticas
          </li>
          {scopes.map((scope) => (
            <li key={scope} className="flex gap-2">
              <CheckIcon className="mt-0.5 text-primary" />
              {scopeLabels[scope]}
            </li>
          ))}
        </ul>
      </div>

      {returnHost && (
        <p className="text-xs text-muted-foreground">
          Depois você volta para <strong className="text-foreground">{returnHost}</strong>. Só
          autorize se foi você que pediu para conectar.
        </p>
      )}

      <div className="flex flex-wrap justify-center">
        <Button variant="outline" onClick={() => decide(false)} disabled={pending !== null}>
          {pending === "deny" ? "Cancelando…" : "Cancelar"}
        </Button>
        <Button onClick={() => decide(true)} disabled={pending !== null || client.isPending}>
          {pending === "accept" ? "Autorizando…" : "Autorizar"}
        </Button>
      </div>

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          <span aria-hidden>✕ </span>
          {failure}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md items-center gap-6 p-8 text-center pixel-drop">
        {children}
      </Card>
    </main>
  );
}
