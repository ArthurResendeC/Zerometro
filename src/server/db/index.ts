import { env } from "../env";
import { createDb } from "./client";

/** Conexão única da aplicação. Testes devem usar `createTestDb()` de ./client. */
export const db = createDb(env.DATABASE_PATH);

export * from "./schema";
