import { describe, expect, test } from "bun:test";
import { heatLevel, heatThresholds } from "./heat-levels";

describe("heatLevel", () => {
  test("degraus: abaixo do mínimo, mínimo até 2h, 2h–4h e 4h+", () => {
    expect([0, 1, 29, 30, 119, 120, 239, 240, 900].map((m) => heatLevel(m, 30))).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  test("um mínimo da ofensiva alto empurra os outros degraus", () => {
    expect(heatThresholds(90)).toEqual([90, 180, 360]);
    expect(heatLevel(150, 90)).toBe(2);
  });
});
