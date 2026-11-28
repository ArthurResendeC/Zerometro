import { describe, expect, test } from "bun:test";
import { achievementCoins, playtimeCoins } from "./economy";

describe("playtimeCoins", () => {
  test.each([
    [0, 0],
    [5, 0], // menos de 6min ainda não fecha uma moeda
    [6, 1],
    [60, 10],
    [90, 15],
    [360, 60],
    [361, 60], // teto de 6h
    [1000, 60],
    [-30, 0],
  ])("%i min → %i moedas", (minutes, coins) => {
    expect(playtimeCoins(minutes)).toBe(coins);
  });
});

describe("achievementCoins", () => {
  test.each([
    [0.4, 50],
    [5, 50],
    [5.1, 30],
    [10, 30],
    [25, 15],
    [50, 10],
    [50.1, 5],
    [100, 5],
    [null, 5],
  ])("%p%% → %i moedas", (rarity, coins) => {
    expect(achievementCoins(rarity)).toBe(coins);
  });
});
