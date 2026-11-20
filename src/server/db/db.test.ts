import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb, createTestDb, type Db, MIGRATIONS_FOLDER, runMigrations } from "./client";
import { completions, games, libraryEntries, objectives, playSessions, user } from "./schema";

const U = "user-1";

let db: Db;

beforeEach(() => {
  db = createTestDb();
  db.insert(user).values({ id: U, name: "Dono", email: "dono@zerometro.test" }).run();
});

function insertGame() {
  return db
    .insert(games)
    .values({ igdbId: 1, name: "Persona 5 Royal", platforms: ["PS5", "PC"], genres: ["RPG"] })
    .returning()
    .get();
}

describe("schema", () => {
  test("aplica as PRAGMAs", () => {
    const fk = db.$client.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
  });

  test("colunas JSON e defaults de timestamp", () => {
    const game = insertGame();

    expect(game.platforms).toEqual(["PS5", "PC"]);
    expect(game.genres).toEqual(["RPG"]);
    expect(game.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("igdb_id é único", () => {
    insertGame();
    expect(() => insertGame()).toThrow();
  });

  test("apagar o jogo apaga entrada e sessões em cascata", () => {
    const game = insertGame();
    db.insert(libraryEntries).values({ userId: U, gameId: game.id, status: "playing" }).run();
    db.insert(playSessions)
      .values({ userId: U, gameId: game.id, playedOn: "2026-11-19", minutes: 90 })
      .run();

    db.delete(games).where(eq(games.id, game.id)).run();

    expect(db.select().from(libraryEntries).all()).toHaveLength(0);
    expect(db.select().from(playSessions).all()).toHaveLength(0);
  });

  test("cada usuário tem no máximo uma entrada por jogo", () => {
    const game = insertGame();
    db.insert(libraryEntries).values({ userId: U, gameId: game.id, status: "backlog" }).run();

    expect(() =>
      db.insert(libraryEntries).values({ userId: U, gameId: game.id, status: "playing" }).run(),
    ).toThrow();

    db.insert(user).values({ id: "user-2", name: "Amigo", email: "amigo@zerometro.test" }).run();
    db.insert(libraryEntries)
      .values({ userId: "user-2", gameId: game.id, status: "playing" })
      .run();
    expect(db.select().from(libraryEntries).all()).toHaveLength(2);
  });

  test("apagar o usuário apaga só os dados dele", () => {
    const game = insertGame();
    db.insert(libraryEntries).values({ userId: U, gameId: game.id, status: "playing" }).run();
    db.insert(playSessions)
      .values({ userId: U, gameId: game.id, playedOn: "2026-11-19", minutes: 30 })
      .run();

    db.delete(user).where(eq(user.id, U)).run();

    expect(db.select().from(libraryEntries).all()).toHaveLength(0);
    expect(db.select().from(playSessions).all()).toHaveLength(0);
    expect(db.select().from(games).all()).toHaveLength(1); // cache do IGDB fica
  });

  test("rejeita minutos <= 0 e nota fora de 1..10", () => {
    const game = insertGame();

    expect(() =>
      db
        .insert(playSessions)
        .values({ userId: U, gameId: game.id, playedOn: "2026-11-19", minutes: 0 })
        .run(),
    ).toThrow();
    expect(() =>
      db
        .insert(libraryEntries)
        .values({ userId: U, gameId: game.id, status: "finished", rating: 11 })
        .run(),
    ).toThrow();
  });

  test("rejeita sessão de jogo inexistente (foreign key)", () => {
    expect(() =>
      db
        .insert(playSessions)
        .values({ userId: U, gameId: 999, playedOn: "2026-11-19", minutes: 30 })
        .run(),
    ).toThrow();
  });

  test("updated_at muda no update", async () => {
    const game = insertGame();
    await Bun.sleep(5);

    const updated = db
      .update(games)
      .set({ name: "Persona 5 Royal (PC)" })
      .where(eq(games.id, game.id))
      .returning()
      .get();

    expect(updated?.updatedAt).not.toBe(game.updatedAt);
  });
});

describe("objetivos", () => {
  test("progresso fica entre 0 e o alvo, e o alvo é pelo menos 1", () => {
    const game = insertGame();
    const values = { userId: U, gameId: game.id, title: "Sementes Korok" };

    expect(() =>
      db
        .insert(objectives)
        .values({ ...values, target: 0 })
        .run(),
    ).toThrow();
    expect(() =>
      db
        .insert(objectives)
        .values({ ...values, target: 900, progress: 901 })
        .run(),
    ).toThrow();
    expect(() =>
      db
        .insert(objectives)
        .values({ ...values, progress: -1 })
        .run(),
    ).toThrow();
    db.insert(objectives)
      .values({ ...values, target: 900, progress: 900 })
      .run();
  });

  test("id externo é único por jogo e fonte; manuais (sem id) não", () => {
    const game = insertGame();
    const steam = { userId: U, gameId: game.id, source: "steam" as const, externalId: "ACH_1" };

    db.insert(objectives)
      .values({ ...steam, title: "A" })
      .run();
    expect(() =>
      db
        .insert(objectives)
        .values({ ...steam, title: "B" })
        .run(),
    ).toThrow();
    db.insert(objectives).values({ userId: U, gameId: game.id, title: "C" }).run();
    db.insert(objectives).values({ userId: U, gameId: game.id, title: "D" }).run();
  });
});

/** O último comando da migration é o que copia os zerados para `completions`. */
async function backfill() {
  const migration = await Bun.file(join(MIGRATIONS_FOLDER, "0005_conclusoes.sql")).text();
  const statement = migration.split("--> statement-breakpoint").at(-1)!;
  db.$client.run(statement);
}

describe("migration 0005: zerados viram conclusões", () => {
  test("cria uma conclusão da história por jogo zerado, sem duplicar se rodar de novo", async () => {
    const game = insertGame();
    const other = db.insert(games).values({ igdbId: 2, name: "Hades" }).returning().get();
    const playing = db.insert(games).values({ igdbId: 3, name: "Celeste" }).returning().get();
    db.insert(libraryEntries)
      .values([
        { userId: U, gameId: game.id, status: "finished", finishedAt: "2026-03-10" },
        // Sem data de término: usa o dia da última atualização em São Paulo (UTC-3).
        {
          userId: U,
          gameId: other.id,
          status: "finished",
          updatedAt: "2026-05-02T01:30:00.000Z",
        },
        { userId: U, gameId: playing.id, status: "playing" },
      ])
      .run();

    await backfill();
    await backfill();

    const rows = db
      .select({ gameId: completions.gameId, type: completions.type, on: completions.completedOn })
      .from(completions)
      .all();
    expect(rows.toSorted((a, b) => a.gameId - b.gameId)).toEqual([
      { gameId: game.id, type: "main", on: "2026-03-10" },
      { gameId: other.id, type: "main", on: "2026-05-01" },
    ]);
  });
});

/** Banco migrado só até `last` (uma cópia da pasta de migrations com o journal cortado). */
async function migratedUntil(last: number) {
  const folder = mkdtempSync(join(tmpdir(), "zerometro-migrations-"));
  mkdirSync(join(folder, "meta"));
  const journal = await Bun.file(join(MIGRATIONS_FOLDER, "meta", "_journal.json")).json();
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= last);
  await Bun.write(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  await Promise.all(
    journal.entries.map((entry: { tag: string }) =>
      Bun.write(
        join(folder, `${entry.tag}.sql`),
        Bun.file(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)),
      ),
    ),
  );
  const old = createDb(":memory:");
  runMigrations(old, folder);
  return old;
}

describe("migration 0007: um dono só, sem as tabelas da Better Auth", () => {
  test("os dados de quem mais jogou passam para `owner`; os outros usuários saem", async () => {
    const old = await migratedUntil(6);
    const sql = (statement: string) => old.$client.run(statement);
    sql(`INSERT INTO user (id, name, email) VALUES
      ('google-eu', 'Eu', 'eu@gmail.com'), ('google-amigo', 'Amigo', 'amigo@gmail.com')`);
    sql(`INSERT INTO session (id, expires_at, token, user_id) VALUES ('s', 0, 't', 'google-eu')`);
    sql(`INSERT INTO games (id, igdb_id, name) VALUES (1, 1, 'Hades'), (2, 2, 'Celeste')`);
    sql(`INSERT INTO library_entries (user_id, game_id, status) VALUES
      ('google-eu', 1, 'playing'), ('google-eu', 2, 'finished'), ('google-amigo', 1, 'backlog')`);
    sql(`INSERT INTO play_sessions (user_id, game_id, played_on, minutes) VALUES
      ('google-eu', 1, '2026-11-01', 30), ('google-eu', 1, '2026-11-02', 45),
      ('google-amigo', 1, '2026-11-02', 10)`);
    sql(
      `INSERT INTO completions (user_id, game_id, type, completed_on) VALUES ('google-eu', 2, 'main', '2026-10-01')`,
    );
    sql(
      `INSERT INTO objectives (user_id, game_id, title) VALUES ('google-eu', 1, 'Zerar no Inferno')`,
    );
    sql(
      `INSERT INTO activity_log (user_id, actor, action) VALUES ('google-eu', 'web', 'x'), (NULL, 'job', 'y')`,
    );
    sql(`INSERT INTO kv (key, value) VALUES
      ('settings:google-eu', '{"meu":1}'), ('settings:google-amigo', '{"dele":1}'), ('igdb:token', 'abc')`);

    runMigrations(old);

    const all = (query: string) => old.$client.query(query).all();
    expect(all("SELECT id FROM user")).toEqual([{ id: "owner" }]);
    expect(all("SELECT user_id, game_id, status FROM library_entries ORDER BY game_id")).toEqual([
      { user_id: "owner", game_id: 1, status: "playing" },
      { user_id: "owner", game_id: 2, status: "finished" },
    ]);
    expect(all("SELECT user_id, minutes FROM play_sessions ORDER BY id")).toEqual([
      { user_id: "owner", minutes: 30 },
      { user_id: "owner", minutes: 45 },
    ]);
    expect(all("SELECT user_id FROM completions")).toEqual([{ user_id: "owner" }]);
    expect(all("SELECT user_id FROM objectives")).toEqual([{ user_id: "owner" }]);
    expect(all("SELECT user_id FROM activity_log ORDER BY id")).toEqual([
      { user_id: "owner" },
      { user_id: null },
    ]);
    expect(all("SELECT key, value FROM kv ORDER BY key")).toEqual([
      { key: "igdb:token", value: "abc" },
      { key: "settings:owner", value: '{"meu":1}' },
    ]);
    const tables = all("SELECT name FROM sqlite_master WHERE type = 'table'").map(
      (row) => (row as { name: string }).name,
    );
    for (const gone of ["session", "account", "verification", "jwks", "oauth_client"]) {
      expect(tables).not.toContain(gone);
    }
  });

  test("banco novo: só o `owner`", () => {
    expect(db.$client.query("SELECT id FROM user WHERE id = 'owner'").all()).toEqual([
      { id: "owner" },
    ]);
  });
});
