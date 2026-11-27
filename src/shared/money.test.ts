import { describe, expect, test } from "bun:test";
import { formatBrl, parseBrl, reaisToCents } from "./money";

describe("dinheiro", () => {
  test("formata em reais", () => {
    expect(formatBrl(5990)).toBe("R$ 59,90");
    expect(formatBrl(0)).toBe("R$ 0,00");
    expect(formatBrl(123456)).toBe("R$ 1.234,56");
  });

  test("lê o preço digitado", () => {
    expect(parseBrl("59,90")).toBe(5990);
    expect(parseBrl("R$ 59,9")).toBe(5990);
    expect(parseBrl("59.90")).toBe(5990);
    expect(parseBrl("60")).toBe(6000);
    expect(parseBrl("0")).toBe(0);
    expect(parseBrl("1.234,56")).toBe(123456);
    expect(parseBrl("1.234")).toBe(123400);
    expect(parseBrl(" r$1234 ")).toBe(123400);
  });

  test("recusa o que não é preço", () => {
    for (const text of ["", "abc", "-10", "1,2,3", "59,999", "100.000,00", ",50"]) {
      expect(parseBrl(text)).toBeNull();
    }
  });

  test("reais do MCP viram centavos sem erro de arredondamento", () => {
    expect(reaisToCents(47.49)).toBe(4749);
    expect(reaisToCents(0.1 + 0.2)).toBe(30);
  });
});
