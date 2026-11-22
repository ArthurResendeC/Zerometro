import { describe, expect, test } from "bun:test";
import { lastClosedRecapDate, recapQuerySchema, recapRange, shiftRecap } from "./recap";

describe("recapRange", () => {
  test("semana de segunda a domingo", () => {
    expect(recapRange("week", "2026-11-19")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(recapRange("week", "2026-11-22")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    // Atravessando o ano.
    expect(recapRange("week", "2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  test("mês inteiro, com fevereiro bissexto e dezembro", () => {
    expect(recapRange("month", "2026-11-19")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(recapRange("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(recapRange("month", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("shiftRecap / lastClosedRecapDate", () => {
  test("anda de período em período, atravessando o ano", () => {
    expect(shiftRecap("week", "2026-11-19", -1)).toBe("2026-11-09");
    expect(shiftRecap("week", "2026-11-19", 1)).toBe("2026-11-23");
    expect(shiftRecap("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftRecap("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftRecap("month", "2026-11-19", -13)).toBe("2025-10-01");
  });

  test("o último fechado é a semana passada ou o mês passado", () => {
    expect(lastClosedRecapDate("week", "2026-11-16")).toBe("2026-11-09");
    expect(lastClosedRecapDate("month", "2026-11-01")).toBe("2026-10-01");
  });
});

test("query: período obrigatório, data opcional e válida", () => {
  expect(recapQuerySchema.safeParse({ period: "week" }).success).toBe(true);
  expect(recapQuerySchema.safeParse({ period: "year" }).success).toBe(false);
  expect(recapQuerySchema.safeParse({ period: "month", date: "2026-02-30" }).success).toBe(false);
});
