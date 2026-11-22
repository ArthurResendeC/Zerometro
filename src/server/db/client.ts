import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DEFAULT_TIME_ZONE } from "../../shared/dates";
import { runDataMigrations } from "./data-migrations";
import * as schema from "./schema";

export const MIGRATIONS_FOLDER = join(import.meta.dir, "migrations");

/** Abre (ou cria) o banco com as PRAGMAs do projeto. Use ":memory:" nos testes. */
export function createDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run("PRAGMA busy_timeout = 5000;"); // MCP, jobs e web podem escrever ao mesmo tempo
  sqlite.run("PRAGMA synchronous = NORMAL;"); // seguro com WAL e bem mais rápido

  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
/** Transação do Drizzle (mesma API de escrita do Db). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/**
 * Migrations do Drizzle e, com a pasta do projeto (schema atual), as migrations de dados em TS.
 * `timeZone` é o do usuário (para os dias das sessões).
 */
export function runMigrations(
  db: Db,
  migrationsFolder: string = MIGRATIONS_FOLDER,
  timeZone: string = DEFAULT_TIME_ZONE,
) {
  migrate(db, { migrationsFolder });
  if (migrationsFolder === MIGRATIONS_FOLDER) runDataMigrations(db, timeZone);
}

/** Banco em memória já migrado, para testes. */
export function createTestDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}
