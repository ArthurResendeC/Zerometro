import { createMcpHandler } from "@modelcontextprotocol/server";
import type { AuthGateway } from "../auth";
import { createMcpServer, type McpDeps } from "./server";

// Rotas públicas fora de /api, na raiz do domínio:
// - /.well-known/*: descoberta OAuth (RFC 8414/9728) e OIDC, servidas pela Better Auth
// - /mcp: o servidor MCP (Streamable HTTP), só com access token válido

export interface RootRoutes {
  wellKnown: (request: Request) => Promise<Response>;
  mcp: (request: Request) => Promise<Response>;
}

export function createRootRoutes(deps: McpDeps & { auth: AuthGateway }): RootRoutes {
  // Um McpServer novo por requisição (sem estado entre chamadas), já no escopo do usuário
  // do token. Atende a revisão 2026-07-28 e, por compatibilidade, a de 2025 sem sessão.
  const handler = createMcpHandler(
    ({ authInfo }) => createMcpServer(deps, String(authInfo?.extra?.userId)),
    { onerror: (error) => console.error("[mcp]", error) },
  );

  return {
    wellKnown: (request) => deps.auth.handler(request),
    mcp: deps.auth.protectMcp((request, userId) =>
      handler.fetch(request, {
        authInfo: { token: "", clientId: "", scopes: [], extra: { userId } },
      }),
    ),
  };
}
