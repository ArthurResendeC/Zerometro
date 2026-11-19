import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
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

export function runMigrations(db: Db, migrationsFolder: string = MIGRATIONS_FOLDER) {
  migrate(db, { migrationsFolder });
}

/** Banco em memória já migrado, para testes. */
export function createTestDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}
