import { describe, expect, test } from "bun:test";
import { displayStateOf, estimateProgress } from "./completions";

const ttb = { mainSec: 10 * 3600, extraSec: 20 * 3600, completeSec: 40 * 3600 };

type Args = Parameters<typeof estimateProgress>[0];
const estimate = (hours: number, fields: Partial<Args> = {}) =>
  estimateProgress({
    minutesPlayed: hours * 60,
    timeToBeat: ttb,
    best: null,
    goal: "main",
    goalMinutes: null,
    ...fields,
  });

describe("estimateProgress (meta do jogo)", () => {
  test("rumo à meta pelo tempo do IGDB; sem tempo para a meta, sem barra", () => {
    expect(estimate(5)).toEqual({ progress: 0.5, goal: "main", targetMinutes: 600, done: false });
    expect(estimate(10, { goal: "extras" })).toMatchObject({ progress: 0.5, targetMinutes: 1200 });
    expect(estimate(5, { timeToBeat: { ...ttb, mainSec: null } })).toEqual({
      progress: null,
      goal: "main",
      targetMinutes: null,
      done: false,
    });
    expect(estimate(5, { timeToBeat: null }).progress).toBeNull();
  });

  test("passar do tempo do IGDB sem marcar a conclusão para em 99%", () => {
    expect(estimate(50)).toMatchObject({ progress: 0.99, done: false });
  });

  test("conclusão no nível da meta (ou acima) enche, mesmo zerando antes do IGDB", () => {
    expect(estimate(6, { best: "main" })).toEqual({
      progress: 1,
      goal: "main",
      targetMinutes: 600,
      done: true,
    });
    expect(estimate(6, { best: "full", goal: "extras" })).toMatchObject({
      progress: 1,
      done: true,
    });
    // Sem tempo no IGDB, a conclusão marcada ainda enche.
    expect(estimate(6, { best: "main", timeToBeat: null })).toMatchObject({
      progress: 1,
      done: true,
    });
  });

  test("a meta não muda sozinha: zerar a história não leva a barra para os extras", () => {
    expect(estimate(12, { best: "main", goal: "extras" })).toMatchObject({
      progress: 0.6,
      goal: "extras",
      done: false,
    });
  });

  test("meta em horas: o alvo do usuário, que enche ao ser alcançado", () => {
    expect(estimate(300, { goal: "hours", goalMinutes: 500 * 60 })).toEqual({
      progress: 0.6,
      goal: "hours",
      targetMinutes: 30_000,
      done: false,
    });
    expect(estimate(40, { goal: "hours", goalMinutes: 40 * 60 })).toMatchObject({
      progress: 1,
      done: true,
    });
  });

  test("sem barra", () => {
    expect(estimate(5, { goal: "none", best: "main" })).toEqual({
      progress: null,
      goal: "none",
      targetMinutes: null,
      done: false,
    });
  });
});

describe("displayStateOf", () => {
  const completion = {
    best: "main" as const,
    count: 1,
    firstCompletedOn: "2026-01-01",
    lastCompletedOn: "2026-01-01",
  };

  test("jogando + conclusão = pós-jogo; o resto é o próprio status", () => {
    expect(displayStateOf("playing", completion)).toBe("postgame");
    expect(displayStateOf("playing", null)).toBe("playing");
    expect(displayStateOf("finished", completion)).toBe("finished");
    expect(displayStateOf("paused", completion)).toBe("paused");
  });
});
