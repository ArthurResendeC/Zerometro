import { describe, expect, test } from "bun:test";
import type { FeedKey } from "../../shared/feeds";
import { createTestDb } from "../db/client";
import { IgdbError, IgdbNotConfiguredError } from "../errors";
import { createFakeIgdb, createTestClock, fakeFeedGame, TEST_NOW } from "../testing";
import { createFeedsService, saveFeedSnapshot } from "./feeds";
import { getKv, setKv } from "./kv";

const HOUR = 60 * 60 * 1000;

function setup(options: { failWith?: Error } = {}) {
  const db = createTestDb();
  const clock = createTestClock();
  const igdb = createFakeIgdb([], {
    top_rated: [fakeFeedGame({ igdbId: 1, name: "Bem avaliado" })],
    trending: [fakeFeedGame({ igdbId: 2, name: "Em alta" })],
    upcoming: [fakeFeedGame({ igdbId: 3, name: "Em breve" })],
  });
  if (options.failWith) {
    const error = options.failWith;
    igdb.getFeed = async (key) => {
      igdb.calls.getFeed.push(key);
      throw error;
    };
  }
  const errors: FeedKey[] = [];
  const feeds = createFeedsService({ db, igdb, clock, onError: (_e, key) => errors.push(key) });
  return { db, clock, igdb, feeds, errors };
}

describe("feeds", () => {
  test("sem cache: busca no IGDB, devolve e guarda", async () => {
    const { db, igdb, feeds } = setup();

    const result = await feeds.getFeeds();

    expect(result.map((f) => [f.key, f.games[0]?.name, f.updatedAt])).toEqual([
      ["top_rated", "Bem avaliado", TEST_NOW.toISOString()],
      ["trending", "Em alta", TEST_NOW.toISOString()],
      ["upcoming", "Em breve", TEST_NOW.toISOString()],
    ]);
    expect(igdb.calls.getFeed).toEqual(["top_rated", "trending", "upcoming"]);
    expect(getKv(db, "feed:trending")).toContain("Em alta");
  });

  test("cache com menos de 24h não chama o IGDB", async () => {
    const { clock, igdb, feeds } = setup();
    await feeds.getFeeds();

    clock.set(new Date(TEST_NOW.getTime() + 23 * HOUR));
    await feeds.getFeeds();

    expect(igdb.calls.getFeed).toHaveLength(3);
  });

  test("cache vencido: devolve o guardado na hora e atualiza em segundo plano", async () => {
    const { db, clock, igdb, feeds } = setup();
    saveFeedSnapshot(db, "upcoming", [fakeFeedGame({ name: "Antigo" })], TEST_NOW);

    clock.set(new Date(TEST_NOW.getTime() + 25 * HOUR));
    const stale = await feeds.getFeeds();
    expect(stale.find((f) => f.key === "upcoming")?.games[0]?.name).toBe("Antigo");

    await feeds.settled();
    const fresh = await feeds.getFeeds();
    expect(fresh.find((f) => f.key === "upcoming")?.games[0]?.name).toBe("Em breve");
    expect(igdb.calls.getFeed.filter((k) => k === "upcoming")).toHaveLength(1);
  });

  test("pedidos simultâneos compartilham a mesma atualização", async () => {
    const { igdb, feeds } = setup();
    await Promise.all([feeds.getFeeds(), feeds.getFeeds()]);
    expect(igdb.calls.getFeed).toHaveLength(3);
  });

  test("IGDB falhou: mantém o cache, registra o erro e espera antes de tentar de novo", async () => {
    const { db, clock, igdb, feeds, errors } = setup({ failWith: new IgdbError("fora do ar") });
    saveFeedSnapshot(db, "top_rated", [fakeFeedGame({ name: "Guardado" })], TEST_NOW);
    clock.set(new Date(TEST_NOW.getTime() + 25 * HOUR));

    const first = await feeds.getFeeds();
    await feeds.settled();
    expect(first.find((f) => f.key === "top_rated")?.games[0]?.name).toBe("Guardado");
    expect(first.find((f) => f.key === "trending")).toEqual({
      key: "trending",
      games: [],
      updatedAt: null,
    });
    expect(errors.toSorted()).toEqual(["top_rated", "trending", "upcoming"]);

    await feeds.getFeeds();
    await feeds.settled();
    expect(igdb.calls.getFeed).toHaveLength(3); // ainda dentro da espera

    clock.set(new Date(TEST_NOW.getTime() + 26 * HOUR));
    await feeds.getFeeds();
    await feeds.settled();
    expect(igdb.calls.getFeed).toHaveLength(6);
  });

  test("IGDB não configurado: listas vazias, sem registrar erro", async () => {
    const { feeds, errors } = setup({ failWith: new IgdbNotConfiguredError() });
    const result = await feeds.getFeeds();
    expect(result.every((f) => f.games.length === 0 && f.updatedAt === null)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("cache corrompido é tratado como vazio", async () => {
    const { db, feeds } = setup();
    setKv(db, "feed:top_rated", "{não é json");
    const result = await feeds.getFeeds();
    expect(result[0]?.games[0]?.name).toBe("Bem avaliado");
  });
});
