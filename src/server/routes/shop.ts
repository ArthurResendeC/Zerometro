import { purchaseSchema } from "../../shared/items";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { getShop, purchaseItem } from "../services/shop";

/** Loja: a vitrine (com o saldo) e a compra com moedas. */
export function createShopRoutes(deps: AppDeps) {
  return createRouter()
    .get("/", (c) => c.json(getShop(webContext(deps, c))))
    .post("/purchase", validate("json", purchaseSchema), (c) =>
      c.json(purchaseItem(webContext(deps, c), c.req.valid("json")), 201),
    );
}
