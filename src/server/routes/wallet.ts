import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { getWallet } from "../services/economy";

/** Carteira de moedas: saldo e lançamentos (acerta o livro-razão com os dados a cada leitura). */
export function createWalletRoutes(deps: AppDeps) {
  return createRouter().get("/", (c) => c.json(getWallet(webContext(deps, c))));
}
