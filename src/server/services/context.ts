import type { ActivityActor } from "../../shared/domain";
import type { Db } from "../db/client";

/**
 * Contexto de uma operação de escrita/leitura: banco, "hoje" no fuso do usuário e quem está agindo.
 * As rotas REST montam com actor "web", as tools do MCP com "mcp", os jobs com "job".
 */
export interface ServiceContext {
  db: Db;
  /** YYYY-MM-DD no fuso do usuário. */
  today: string;
  actor: ActivityActor;
}
