import { todayIn } from "../../shared/dates";
import type { ActivityActor } from "../../shared/domain";
import type { Db, DbOrTx } from "../db/client";

/** Fonte de tempo injetável: produção usa o relógio real, testes um instante fixo. */
export interface Clock {
  now: () => Date;
  /** Fuso do usuário (ex.: America/Sao_Paulo). */
  timeZone: string;
}

/** Banco (ou transação) + dono dos dados: toda leitura de dados do usuário passa por aqui. */
export interface UserScope {
  db: DbOrTx;
  userId: string;
}

/**
 * Contexto de uma operação: banco, usuário, "agora"/"hoje" no fuso e quem está agindo.
 * As rotas REST montam com actor "web", as tools do MCP com "mcp", os jobs com "job".
 */
export interface ServiceContext extends UserScope {
  db: Db;
  now: Date;
  timeZone: string;
  /** YYYY-MM-DD no fuso do usuário. */
  today: string;
  actor: ActivityActor;
}

export function createContext(
  db: Db,
  clock: Clock,
  actor: ActivityActor,
  userId: string,
): ServiceContext {
  const now = clock.now();
  return { db, userId, now, timeZone: clock.timeZone, today: todayIn(clock.timeZone, now), actor };
}
