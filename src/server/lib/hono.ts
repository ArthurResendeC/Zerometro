import { type Context, Hono } from "hono";
import type { AppDeps } from "../app";
import { createContext, type ServiceContext } from "../services/context";

/** Variáveis por requisição: o middleware de auth garante `userId` nas rotas protegidas. */
export interface AppEnv {
  Variables: { userId: string };
}

export const createRouter = () => new Hono<AppEnv>();

/** Contexto de serviço da requisição web (usuário logado, relógio, actor "web"). */
export function webContext(
  deps: Pick<AppDeps, "db" | "clock">,
  c: Context<AppEnv>,
): ServiceContext {
  return createContext(deps.db, deps.clock, "web", c.get("userId"));
}
