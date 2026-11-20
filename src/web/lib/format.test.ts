import { describe, expect, test } from "bun:test";
import { daysBetween, formatCount, formatCountdown, formatReleaseDate } from "./format";

describe("formatReleaseDate", () => {
  test("usa a precisão que o IGDB conhece", () => {
    expect(formatReleaseDate("2027-02-23", "day")).toBe("23/02/2027");
    expect(formatReleaseDate("2027-02-23", null)).toBe("23/02/2027");
    expect(formatReleaseDate("2027-03-31", "month")).toMatch(/^mar\.? de 2027$/);
    expect(formatReleaseDate("2027-09-30", "quarter")).toBe("3º tri. 2027");
    expect(formatReleaseDate("2028-12-31", "year")).toBe("2028");
  });
});

describe("contagem regressiva", () => {
  test("conta dias entre datas, inclusive virando o ano", () => {
    expect(daysBetween("2026-11-19", "2027-02-23")).toBe(96);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-11-19", "2026-11-18")).toBe(-1);
  });

  test("fala como gente", () => {
    expect(formatCountdown(0)).toBe("Sai hoje");
    expect(formatCountdown(1)).toBe("Sai amanhã");
    expect(formatCountdown(96)).toBe("Faltam 96 dias");
    expect(formatCountdown(1200)).toBe("Faltam 1.200 dias");
    expect(formatCount(2351)).toBe("2.351");
  });
});
