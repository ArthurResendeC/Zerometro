import { describe, expect, test } from "bun:test";
import { createTestDb } from "../db/client";
import { IgdbError, IgdbNotConfiguredError, NotFoundError } from "../errors";
import { createFakeIgdb, createTestClock, fakeGamePage, fakeIgdbGame, TEST_NOW } from "../testing";
import { createGamePagesService, saveGamePage } from "./game-pages";
import { getKv, setKv } from "./kv";

const HOUR = 60 * 60 * 1000;
const ID = fakeIgdbGame().igdbId;

function setup(options: { failWith?: Error } = {}) {
  const db = createTestDb();
  const clock = createTestClock();
  const igdb = createFakeIgdb();
  if (options.failWith) {
    const error = options.failWith;
    igdb.getGamePage = async (igdbId) => {
      igdb.calls.getGamePage.push(igdbId);
      throw error;
    };
  }
  const errors: number[] = [];
  const pages = createGamePagesService({ db, igdb, clock, onError: (_e, id) => errors.push(id) });
  return { db, clock, igdb, pages, errors };
}

describe("gamePages", () => {
  test("sem cache: busca no IGDB, devolve e guarda com a versão na chave", async () => {
    const { db, igdb, pages } = setup();

    const { value, updatedAt } = await pages.get(ID);

    expect(value.name).toBe("Persona 5 Royal");
    expect(updatedAt).toBe(TEST_NOW.toISOString());
    expect(igdb.calls.getGamePage).toEqual([ID]);
    expect(getKv(db, `igdb:game:v1:${ID}`)).toContain("Persona 5 Royal");
  });

  test("cache com menos de 24h não chama o IGDB; vencido devolve e atualiza", async () => {
    const { db, clock, igdb, pages } = setup();
    saveGamePage(db, fakeGamePage(fakeIgdbGame({ name: "Nome antigo" })), TEST_NOW);

    clock.set(new Date(TEST_NOW.getTime() + 23 * HOUR));
    expect((await pages.get(ID)).value.name).toBe("Nome antigo");
    expect(igdb.calls.getGamePage).toEqual([]);

    clock.set(new Date(TEST_NOW.getTime() + 25 * HOUR));
    expect((await pages.get(ID)).value.name).toBe("Nome antigo");
    await pages.settled();
    expect((await pages.get(ID)).value.name).toBe("Persona 5 Royal");
    expect(igdb.calls.getGamePage).toEqual([ID]);
  });

  test("jogo inexistente: NotFoundError, sem guardar nem registrar erro", async () => {
    const { db, pages, errors } = setup();

    await expect(pages.get(999)).rejects.toBeInstanceOf(NotFoundError);
    expect(getKv(db, "igdb:game:v1:999")).toBeNull();
    expect(errors).toEqual([]);
  });

  test("IGDB falhou sem cache: lança, registra e espera antes de tentar de novo", async () => {
    const { clock, igdb, pages, errors } = setup({ failWith: new IgdbError("fora do ar") });

    await expect(pages.get(ID)).rejects.toBeInstanceOf(IgdbError);
    await expect(pages.get(ID)).rejects.toBeInstanceOf(IgdbError);
    expect(igdb.calls.getGamePage).toHaveLength(1);
    expect(errors).toEqual([ID]);

    clock.set(new Date(TEST_NOW.getTime() + HOUR));
    await expect(pages.get(ID)).rejects.toBeInstanceOf(IgdbError);
    expect(igdb.calls.getGamePage).toHaveLength(2);
  });

  test("IGDB falhou com cache vencido: continua devolvendo o guardado", async () => {
    const { db, clock, pages, errors } = setup({ failWith: new IgdbError("fora do ar") });
    saveGamePage(db, fakeGamePage(), TEST_NOW);
    clock.set(new Date(TEST_NOW.getTime() + 25 * HOUR));

    expect((await pages.get(ID)).value.igdbId).toBe(ID);
    await pages.settled();
    expect(errors).toEqual([ID]);
  });

  test("IGDB não configurado: lança sem registrar erro", async () => {
    const { pages, errors } = setup({ failWith: new IgdbNotConfiguredError() });
    await expect(pages.get(ID)).rejects.toBeInstanceOf(IgdbNotConfiguredError);
    expect(errors).toEqual([]);
  });

  test("cache corrompido ou de formato antigo é tratado como vazio", async () => {
    const { db, igdb, pages } = setup();
    setKv(db, `igdb:game:v1:${ID}`, JSON.stringify({ value: { name: "sem id" }, updatedAt: "x" }));

    expect((await pages.get(ID)).value.name).toBe("Persona 5 Royal");
    expect(igdb.calls.getGamePage).toHaveLength(1);
  });
});
