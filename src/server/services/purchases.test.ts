import { beforeEach, describe, expect, test } from "bun:test";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import { markCompleted } from "./completions";
import { addToLibrary, getLibraryItem, updateLibraryEntry } from "./library";
import { getPurchaseStats } from "./purchases";
import { getRecap } from "./recap";
import { logSession } from "./sessions";

// TEST_TODAY = 2026-11-19; sem ano, o período vai de 2025-11-17 até hoje.

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale" }),
  fakeIgdbGame({ igdbId: 113112, name: "Hades" }),
  fakeIgdbGame({ igdbId: 1942, name: "The Witcher 3" }),
]);

let ctx: ServiceContext;
let persona: number;
let undertale: number;
let hades: number;
let witcher: number;

beforeEach(async () => {
  ctx = createTestContext();
  persona = (await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" })).gameId;
  undertale = (await addToLibrary(ctx, igdb, { igdbId: 12517, status: "playing" })).gameId;
  hades = (await addToLibrary(ctx, igdb, { igdbId: 113112, status: "playing" })).gameId;
  witcher = (await addToLibrary(ctx, igdb, { igdbId: 1942, status: "backlog" })).gameId;
});

const stats = (year?: number) => getPurchaseStats(ctx, { today: TEST_TODAY, year });

describe("compra na biblioteca", () => {
  test("sem nada informado, a compra é null; com algum campo, vem inteira", () => {
    expect(getLibraryItem(ctx, persona).purchase).toBeNull();
    updateLibraryEntry(ctx, persona, { pricePaidCents: 24990, store: "PlayStation Store" });
    expect(getLibraryItem(ctx, persona).purchase).toEqual({
      acquiredOn: null,
      pricePaidCents: 24990,
      store: "PlayStation Store",
      viaSubscription: false,
    });
  });

  test("assinatura apaga o preço e não aceita preço depois", () => {
    updateLibraryEntry(ctx, hades, { pricePaidCents: 4749 });
    updateLibraryEntry(ctx, hades, { viaSubscription: true, store: "Game Pass" });
    expect(getLibraryItem(ctx, hades).purchase).toMatchObject({
      pricePaidCents: null,
      viaSubscription: true,
    });
    expect(() => updateLibraryEntry(ctx, hades, { pricePaidCents: 100 })).toThrow(/assinatura/);
    // Desmarcar a assinatura e informar o preço juntos vale.
    updateLibraryEntry(ctx, hades, { viaSubscription: false, pricePaidCents: 100 });
    expect(getLibraryItem(ctx, hades).purchase?.pricePaidCents).toBe(100);
  });

  test("data da compra no futuro é recusada", () => {
    expect(() => updateLibraryEntry(ctx, hades, { acquiredOn: "2026-11-20" })).toThrow(/futuro/);
  });
});

describe("comprei × zerei", () => {
  test("sem compras", () => {
    const s = stats();
    expect(s).toMatchObject({
      hasPurchases: false,
      bought: 0,
      spentCents: 0,
      finished: 0,
      costPerHour: [],
      averageCentsPerHour: null,
      unplayed: [],
    });
    expect(s.byMonth.map((m) => m.month)).toHaveLength(13); // nov/2025 a nov/2026
  });

  test("compras e primeiros zerados por mês; replay não conta", () => {
    updateLibraryEntry(ctx, persona, { acquiredOn: "2026-03-02", pricePaidCents: 24990 });
    updateLibraryEntry(ctx, hades, { acquiredOn: "2026-03-20", viaSubscription: true });
    updateLibraryEntry(ctx, witcher, { acquiredOn: "2024-01-01", pricePaidCents: 2000 });
    markCompleted(ctx, undertale, { type: "main", date: "2026-03-10" });
    markCompleted(ctx, undertale, { type: "main", date: "2026-04-10" }); // replay
    markCompleted(ctx, persona, { type: "main", date: "2025-10-01" }); // antes do período

    const s = stats();
    expect(s).toMatchObject({
      hasPurchases: true,
      bought: 2,
      viaSubscription: 1,
      spentCents: 24990,
      finished: 1,
    });
    expect(s.byMonth.find((m) => m.month === "2026-03")).toEqual({
      month: "2026-03",
      bought: 2,
      finished: 1,
      spentCents: 24990,
    });
    expect(s.byMonth.find((m) => m.month === "2026-04")).toMatchObject({ finished: 0 });
  });

  test("custo por hora: só com preço e 1h+ jogada, do mais barato ao mais caro", () => {
    updateLibraryEntry(ctx, persona, { pricePaidCents: 20000, priorMinutes: 100 * 60 });
    updateLibraryEntry(ctx, undertale, { pricePaidCents: 3000, priorMinutes: 10 * 60 });
    updateLibraryEntry(ctx, hades, { pricePaidCents: 5000 });
    logSession(ctx, { gameId: hades, minutes: 30, playedOn: "2026-11-01" }); // menos de 1h
    updateLibraryEntry(ctx, witcher, { pricePaidCents: 0, priorMinutes: 50 * 60 }); // de graça

    const s = stats();
    expect(s.costPerHour.map((g) => [g.name, g.centsPerHour])).toEqual([
      ["Persona 5 Royal", 200],
      ["Undertale", 300],
    ]);
    // (200 + 30) ÷ 110h
    expect(s.averageCentsPerHour).toBe(209);
  });

  test("comprados e nunca jogados, de qualquer data, sem os de assinatura", () => {
    updateLibraryEntry(ctx, witcher, { acquiredOn: "2024-01-01", pricePaidCents: 2000 });
    updateLibraryEntry(ctx, hades, { store: "Game Pass", viaSubscription: true });
    updateLibraryEntry(ctx, undertale, { pricePaidCents: 1500 });
    logSession(ctx, { gameId: undertale, minutes: 10, playedOn: "2026-11-01" });

    const s = stats();
    expect(s.unplayed.map((g) => g.name)).toEqual(["The Witcher 3"]);
    expect(s.unplayedCents).toBe(2000);
  });
});

test("o preço nunca entra no recap", () => {
  updateLibraryEntry(ctx, persona, {
    acquiredOn: "2026-11-10",
    pricePaidCents: 24990,
    store: "PlayStation Store",
  });
  logSession(ctx, { gameId: persona, minutes: 120, playedOn: "2026-11-11" });
  markCompleted(ctx, persona, { type: "main", date: "2026-11-12" });

  const recap = getRecap(ctx, {
    today: TEST_TODAY,
    timeZone: "America/Sao_Paulo",
    period: "week",
    date: "2026-11-12",
  });
  expect(recap.totalMinutes).toBe(120);
  const json = JSON.stringify(recap);
  for (const leak of ["24990", "249,90", "PlayStation Store", "price", "purchase"]) {
    expect(json).not.toContain(leak);
  }
});
