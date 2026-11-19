import type { Db } from "../../db/client";
import type { Env } from "../../env";
import { createIgdbApi, type IgdbApi } from "./api";
import { createDisabledIgdbClient, createIgdbClient, createKvTokenStore } from "./client";

export type { IgdbApi } from "./api";
export { createIgdbApi } from "./api";

/** IGDB real se houver credenciais; senão, um client que responde "não configurado". */
export function createIgdbFromEnv(db: Db, env: Env): IgdbApi {
  const { IGDB_CLIENT_ID: clientId, IGDB_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) {
    console.warn("IGDB_CLIENT_ID/IGDB_CLIENT_SECRET ausentes: busca no IGDB desativada.");
    return createIgdbApi(createDisabledIgdbClient());
  }
  return createIgdbApi(
    createIgdbClient({ clientId, clientSecret, tokenStore: createKvTokenStore(db) }),
  );
}
