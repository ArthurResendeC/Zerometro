import { describe, expect, test } from "bun:test";
import { displayStateOf, estimateProgress } from "./completions";

const ttb = { mainSec: 10 * 3600, extraSec: 20 * 3600, completeSec: 40 * 3600 };

describe("estimateProgress (alvo dinâmico)", () => {
  test("sem conclusão: rumo à história; sem tempo da história, sem estimativa", () => {
    expect(estimateProgress(5 * 60, ttb, null)).toEqual({ progress: 0.5, target: "main" });
    expect(estimateProgress(5 * 60, { ...ttb, mainSec: null }, null)).toEqual({
      progress: null,
      target: "main",
    });
    expect(estimateProgress(5 * 60, null, null)).toEqual({ progress: null, target: "main" });
  });

  test("depois de zerar, o alvo sobe: extras e depois 100%", () => {
    expect(estimateProgress(12 * 60, ttb, "main")).toEqual({ progress: 0.6, target: "extras" });
    expect(estimateProgress(30 * 60, ttb, "extras")).toEqual({ progress: 0.75, target: "full" });
    expect(estimateProgress(30 * 60, ttb, "full")).toEqual({ progress: 1, target: "full" });
  });

  test("pula o nível sem tempo no IGDB; sem nenhum, fica cheio no nível alcançado", () => {
    expect(estimateProgress(20 * 60, { ...ttb, extraSec: null }, "main")).toEqual({
      progress: 0.5,
      target: "full",
    });
    expect(estimateProgress(8 * 60, { ...ttb, extraSec: null, completeSec: null }, "main")).toEqual(
      { progress: 1, target: "main" },
    );
    expect(estimateProgress(8 * 60, null, "extras")).toEqual({ progress: 1, target: "extras" });
  });

  test("limita em 100%", () => {
    expect(estimateProgress(50 * 60, ttb, "main").progress).toBe(1);
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
