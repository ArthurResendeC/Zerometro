import { beforeEach, describe, expect, test } from "bun:test";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import { markCompleted } from "./completions";
import { addToLibrary } from "./library";
import { logSession } from "./sessions";
import { getTimeline } from "./timeline";

// TEST_TODAY = 2026-11-19; sem ano, o período vai de 2025-11-17 até hoje.

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
  fakeIgdbGame({ igdbId: 113112, name: "Hades" }),
]);

let ctx: ServiceContext;
let persona: number;
let undertale: number;
let hades: number;

beforeEach(async () => {
  ctx = createTestContext();
  persona = (await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" })).gameId;
  undertale = (await addToLibrary(ctx, igdb, { igdbId: 12517, status: "paused" })).gameId;
  hades = (await addToLibrary(ctx, igdb, { igdbId: 113112, status: "backlog" })).gameId;
});

const timeline = (year?: number) => getTimeline(ctx, { today: TEST_TODAY, year });
const play = (gameId: number, playedOn: string, minutes = 60) =>
  logSession(ctx, { gameId, minutes, playedOn });

describe("linha do tempo", () => {
  test("sem sessões nem conclusões, nenhum jogo", () => {
    expect(timeline()).toMatchObject({
      from: "2025-11-17",
      to: TEST_TODAY,
      year: null,
      pauseDays: 14,
      games: [],
    });
  });

  test("trechos e pausas por jogo, em ordem de quando apareceram no período", () => {
    play(persona, "2026-03-01", 90);
    play(persona, "2026-03-01", 30); // duas sessões no mesmo dia contam um dia
    play(persona, "2026-03-10");
    play(persona, "2026-05-01");
    play(undertale, "2026-02-01");
    markCompleted(ctx, undertale, { type: "main", date: "2026-02-02" });

    const { games } = timeline();
    expect(games.map((g) => g.name)).toEqual(["Undertale", "Persona 5 Royal"]);
    expect(games[1]).toMatchObject({ status: "playing", minutes: 240, completions: [] });
    expect(games[1]!.spans).toEqual([
      expect.objectContaining({ from: "2026-03-01", to: "2026-03-10", minutes: 180 }),
      expect.objectContaining({ from: "2026-05-01", to: "2026-05-01", playedDays: 1 }),
    ]);
    expect(games[0]!.completions).toEqual([{ completedOn: "2026-02-02", type: "main" }]);
  });

  test("um jogo só com conclusão no período entra sem trechos", () => {
    markCompleted(ctx, hades, { type: "full", date: "2026-06-01" });
    expect(timeline().games).toEqual([
      expect.objectContaining({ name: "Hades", minutes: 0, spans: [] }),
    ]);
  });

  test("num ano passado, o trecho que segue no ano seguinte encosta no fim", () => {
    play(persona, "2025-12-28");
    play(persona, "2026-01-04");
    const [game] = timeline(2025).games;
    expect(game!.spans).toEqual([
      expect.objectContaining({ from: "2025-12-28", to: "2025-12-31", continuesAfter: true }),
    ]);
    expect(timeline(2026).games[0]!.spans[0]).toMatchObject({
      from: "2026-01-01",
      to: "2026-01-04",
      startedBefore: true,
    });
  });

  test("ano futuro fica vazio", () => {
    expect(timeline(2027).games).toEqual([]);
  });
});
