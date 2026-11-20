import { createMcpHandler } from "@modelcontextprotocol/server";
import { type Auth, OWNER_ID } from "../auth";
import { createMcpServer, type McpDeps } from "./server";

// Rotas públicas fora de /api, na raiz do domínio:
// - OAuth do MCP (src/server/oauth): /.well-known/*, /register, /authorize e /token
// - /mcp: o servidor MCP (Streamable HTTP), só com access token válido ou o token da instância

export interface RootRoutes {
  /** Rotas por método, no formato do `Bun.serve`. */
  oauth: Auth["oauth"]["routes"];
  mcp: (request: Request) => Promise<Response>;
}

export function createRootRoutes(deps: McpDeps & { auth: Auth }): RootRoutes {
  // Um McpServer novo por requisição (sem estado entre chamadas), já no escopo do dono. Atende a
  // revisão 2026-07-28 e, por compatibilidade, a de 2025 sem sessão.
  const handler = createMcpHandler(() => createMcpServer(deps, OWNER_ID), {
    onerror: (error) => console.error("[mcp]", error),
  });

  return {
    oauth: deps.auth.oauth.routes,
    mcp: deps.auth.oauth.protect((request) => handler.fetch(request)),
  };
}
