import { hc } from "hono/client";
import type { AppType } from "@server/app";

// Cliente RPC tipado de ponta a ponta: api.health.$get(), etc.
export const { api } = hc<AppType>("/");
