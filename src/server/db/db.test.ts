import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "./client";
import { games, libraryEntries, playSessions } from "./schema";

let db: Db;

beforeEach(() => {
  db = createTestDb();
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
    db.insert(libraryEntries).values({ gameId: game.id, status: "playing" }).run();
    db.insert(playSessions).values({ gameId: game.id, playedOn: "2026-11-19", minutes: 90 }).run();

    db.delete(games).where(eq(games.id, game.id)).run();

    expect(db.select().from(libraryEntries).all()).toHaveLength(0);
    expect(db.select().from(playSessions).all()).toHaveLength(0);
  });

  test("um jogo só pode ter uma entrada na biblioteca", () => {
    const game = insertGame();
    db.insert(libraryEntries).values({ gameId: game.id, status: "backlog" }).run();

    expect(() =>
      db.insert(libraryEntries).values({ gameId: game.id, status: "playing" }).run(),
    ).toThrow();
  });

  test("rejeita minutos <= 0 e nota fora de 1..10", () => {
    const game = insertGame();

    expect(() =>
      db.insert(playSessions).values({ gameId: game.id, playedOn: "2026-11-19", minutes: 0 }).run(),
    ).toThrow();
    expect(() =>
      db.insert(libraryEntries).values({ gameId: game.id, status: "finished", rating: 11 }).run(),
    ).toThrow();
  });

  test("rejeita sessão de jogo inexistente (foreign key)", () => {
    expect(() =>
      db.insert(playSessions).values({ gameId: 999, playedOn: "2026-11-19", minutes: 30 }).run(),
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
