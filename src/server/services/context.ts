import { todayIn } from "../../shared/dates";
import type { ActivityActor } from "../../shared/domain";
import type { Db } from "../db/client";

/** Fonte de tempo injetável: produção usa o relógio real, testes um instante fixo. */
export interface Clock {
  now: () => Date;
  /** Fuso do usuário (ex.: America/Sao_Paulo). */
  timeZone: string;
}

/**
 * Contexto de uma operação: banco, "agora"/"hoje" no fuso do usuário e quem está agindo.
 * As rotas REST montam com actor "web", as tools do MCP com "mcp", os jobs com "job".
 */
export interface ServiceContext {
  db: Db;
  now: Date;
  timeZone: string;
  /** YYYY-MM-DD no fuso do usuário. */
  today: string;
  actor: ActivityActor;
}

export function createContext(db: Db, clock: Clock, actor: ActivityActor): ServiceContext {
  const now = clock.now();
  return { db, now, timeZone: clock.timeZone, today: todayIn(clock.timeZone, now), actor };
}
