import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Auth } from "../auth";
import { createMcpServer, type McpDeps } from "./server";

// Rotas públicas fora de /api, na raiz do domínio:
// - OAuth do MCP (src/server/oauth): /.well-known/*, /register, /authorize e /token
// - /mcp: o servidor MCP (Streamable HTTP), só com o access token de um perfil ou o token do admin

export interface RootRoutes {
  /** Rotas por método, no formato do `Bun.serve`. */
  oauth: Auth["oauth"]["routes"];
  mcp: (request: Request) => Promise<Response>;
}

export function createRootRoutes(deps: McpDeps & { auth: Auth }): RootRoutes {
  // Um McpServer novo por requisição (sem estado entre chamadas), no escopo do perfil dono do
  // token. Atende a revisão 2026-07-28 e, por compatibilidade, a de 2025 sem sessão.
  // Um handler por perfil (são poucos), criado no primeiro uso.
  const handlers = new Map<string, ReturnType<typeof createMcpHandler>>();
  const handlerFor = (userId: string) => {
    let handler = handlers.get(userId);
    if (!handler) {
      handler = createMcpHandler(() => createMcpServer(deps, userId), {
        onerror: (error) => console.error("[mcp]", error),
      });
      handlers.set(userId, handler);
    }
    return handler;
  };

  return {
    oauth: deps.auth.oauth.routes,
    mcp: deps.auth.oauth.protect((request, userId) => handlerFor(userId).fetch(request)),
  };
}
