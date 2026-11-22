import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb, createTestDb, type Db, MIGRATIONS_FOLDER, runMigrations } from "./client";
import {
  achievementSets,
  achievementUnlocks,
  achievements,
  completions,
  games,
  libraryEntries,
  objectives,
  playSessions,
  user,
  userAchievementSets,
} from "./schema";

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

function insertSet() {
  const set = db
    .insert(achievementSets)
    .values({ source: "steam", externalId: "504230", fetchedAt: "2026-11-20T00:00:00.000Z" })
    .returning()
    .get();
  const achievement = db
    .insert(achievements)
    .values({ setId: set.id, externalId: "ACH_1", title: "Morango" })
    .returning()
    .get();
  return { set, achievement };
}

describe("conquistas", () => {
  test("a lista é única por fonte e id externo; a conquista, por lista e id externo", () => {
    const { set } = insertSet();
    expect(() =>
      db
        .insert(achievementSets)
        .values({ source: "steam", externalId: "504230", fetchedAt: "x" })
        .run(),
    ).toThrow();
    db.insert(achievementSets)
      .values({ source: "retroachievements", externalId: "504230", fetchedAt: "x" })
      .run();
    expect(() =>
      db.insert(achievements).values({ setId: set.id, externalId: "ACH_1", title: "B" }).run(),
    ).toThrow();
  });

  test("desbloqueio é um por usuário e conquista; cada usuário tem os seus", () => {
    const { achievement } = insertSet();
    const unlock = { achievementId: achievement.id, unlockedAt: "2026-11-20T00:00:00.000Z" };
    db.insert(achievementUnlocks)
      .values({ ...unlock, userId: U })
      .run();
    expect(() =>
      db
        .insert(achievementUnlocks)
        .values({ ...unlock, userId: U })
        .run(),
    ).toThrow();
    db.insert(user).values({ id: "user-2", name: "Amigo", email: "amigo@zerometro.test" }).run();
    db.insert(achievementUnlocks)
      .values({ ...unlock, userId: "user-2" })
      .run();

    db.delete(user).where(eq(user.id, "user-2")).run();
    expect(db.select({ userId: achievementUnlocks.userId }).from(achievementUnlocks).all()).toEqual(
      [{ userId: U }],
    );
  });

  test("apagar a lista leva conquistas, desbloqueios e quem a segue", () => {
    const game = insertGame();
    const { set, achievement } = insertSet();
    db.insert(userAchievementSets).values({ userId: U, gameId: game.id, setId: set.id }).run();
    db.insert(achievementUnlocks)
      .values({ userId: U, achievementId: achievement.id, unlockedAt: "x" })
      .run();

    db.delete(achievementSets).where(eq(achievementSets.id, set.id)).run();

    expect(db.select().from(achievements).all()).toHaveLength(0);
    expect(db.select().from(achievementUnlocks).all()).toHaveLength(0);
    expect(db.select().from(userAchievementSets).all()).toHaveLength(0);
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
    expect(
      all("SELECT key, value FROM kv WHERE key NOT LIKE 'data-migration:%' ORDER BY key"),
    ).toEqual([
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

describe("migration de dados: reagrupar as sessões da Steam", () => {
  test("uma sessão por sincronização vira uma por jogatina, com horário", async () => {
    const old = await migratedUntil(10);
    const sql = (statement: string) => old.$client.run(statement);
    sql(
      `INSERT INTO games (id, igdb_id, name) VALUES (75, 75, 'Phantom Blade Zero'), (1, 1, 'Hades')`,
    );
    sql(`INSERT INTO library_entries (user_id, game_id, status) VALUES
      ('owner', 75, 'playing'), ('owner', 1, 'playing')`);
    // As sessões reais (uma por hora, do job) + uma jogada para trás e uma manual, que ficam.
    const steam: [number, string, number, string][] = [
      [11, "2026-11-21", 1, "2026-11-21T07:46:27.225Z"],
      [12, "2026-11-21", 30, "2026-11-21T08:46:27.440Z"],
      [13, "2026-11-21", 42, "2026-11-21T09:03:37.044Z"],
      [17, "2026-11-21", 30, "2026-11-21T22:46:27.348Z"],
      [18, "2026-11-21", 60, "2026-11-21T23:46:27.420Z"],
      [19, "2026-11-21", 60, "2026-11-22T00:46:27.378Z"],
      [20, "2026-11-21", 60, "2026-11-22T01:46:27.428Z"],
      [21, "2026-11-21", 10, "2026-11-22T02:46:27.412Z"],
      [22, "2026-11-22", 30, "2026-11-22T03:46:27.574Z"],
      [23, "2026-11-22", 60, "2026-11-22T04:46:27.687Z"],
      [24, "2026-11-22", 60, "2026-11-22T05:46:27.726Z"],
      [25, "2026-11-22", 56, "2026-11-22T06:46:27.566Z"],
      [26, "2026-11-22", 22, "2026-11-22T07:40:39.244Z"],
      [30, "2026-11-10", 1440, "2026-11-12T10:00:00.000Z"],
    ];
    for (const [id, day, minutes, createdAt] of steam) {
      sql(`INSERT INTO play_sessions (id, user_id, game_id, played_on, minutes, source, created_at)
        VALUES (${id}, 'owner', 75, '${day}', ${minutes}, 'steam', '${createdAt}')`);
    }
    sql(`INSERT INTO play_sessions (id, user_id, game_id, played_on, minutes, source)
      VALUES (40, 'owner', 1, '2026-11-21', 30, 'manual')`);

    runMigrations(old);

    const rows = () =>
      old.$client
        .query("SELECT id, played_on, minutes, started_at, ended_at FROM play_sessions ORDER BY id")
        .all();
    expect(rows()).toEqual([
      {
        id: 11,
        played_on: "2026-11-21",
        minutes: 73,
        started_at: "2026-11-21T07:50:37.044Z",
        ended_at: "2026-11-21T09:03:37.044Z",
      },
      {
        id: 17,
        played_on: "2026-11-21",
        minutes: 220,
        started_at: "2026-11-21T22:16:27.428Z",
        ended_at: "2026-11-22T01:56:27.428Z",
      },
      {
        id: 22,
        played_on: "2026-11-22",
        minutes: 228,
        started_at: "2026-11-22T03:20:27.566Z",
        ended_at: "2026-11-22T07:08:27.566Z",
      },
      { id: 30, played_on: "2026-11-10", minutes: 1440, started_at: null, ended_at: null },
      { id: 40, played_on: "2026-11-21", minutes: 30, started_at: null, ended_at: null },
    ]);

    // Roda uma vez só.
    sql(`INSERT INTO play_sessions (id, user_id, game_id, played_on, minutes, source, created_at)
      VALUES (50, 'owner', 75, '2026-11-22', 5, 'steam', '2026-11-22T08:00:00.000Z')`);
    runMigrations(old);
    expect(rows()).toHaveLength(6);
    expect(rows().at(-1)).toMatchObject({ id: 50, started_at: null });
  });
});
