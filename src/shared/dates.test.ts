import { describe, expect, test } from "bun:test";
import { addDays, diffInDays, isoDateSchema, parseFriendlyDate, todayIn } from "./dates";

describe("todayIn", () => {
  test("usa o fuso de São Paulo, não UTC", () => {
    // 02:30 UTC do dia 20 ainda é 23:30 do dia 19 em São Paulo (UTC-3).
    const now = new Date("2026-11-20T02:30:00Z");
    expect(todayIn("America/Sao_Paulo", now)).toBe("2026-11-19");
    expect(todayIn("UTC", now)).toBe("2026-11-20");
  });
});

describe("addDays / diffInDays", () => {
  test("atravessa meses e anos bissextos", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("diferença em dias", () => {
    expect(diffInDays("2026-11-18", "2026-11-19")).toBe(1);
    expect(diffInDays("2026-11-19", "2026-11-19")).toBe(0);
    expect(diffInDays("2026-12-31", "2027-01-02")).toBe(2);
  });
});

describe("isoDateSchema", () => {
  test("aceita datas válidas e rejeita inexistentes ou mal formatadas", () => {
    expect(isoDateSchema.safeParse("2026-11-19").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(isoDateSchema.safeParse("19/11/2026").success).toBe(false);
  });
});

describe("parseFriendlyDate", () => {
  const today = "2026-03-01";

  test("entende hoje, ontem e anteontem", () => {
    expect(parseFriendlyDate("hoje", today)).toBe("2026-03-01");
    expect(parseFriendlyDate(" Ontem ", today)).toBe("2026-02-28");
    expect(parseFriendlyDate("anteontem", today)).toBe("2026-02-27");
  });

  test("aceita YYYY-MM-DD e rejeita o resto", () => {
    expect(parseFriendlyDate("2026-01-15", today)).toBe("2026-01-15");
    expect(parseFriendlyDate("semana passada", today)).toBeNull();
  });
});
