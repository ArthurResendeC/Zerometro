import { describe, expect, test } from "bun:test";
import { resolvePublicUrl, tokenProblem } from "./auth";

describe("resolvePublicUrl", () => {
  const base = { NODE_ENV: "production", PORT: 8080 };

  test("PUBLIC_URL vence (sem barra no fim)", () => {
    expect(
      resolvePublicUrl({
        ...base,
        PUBLIC_URL: "https://zerometro.exemplo.com/",
        RAILWAY_PUBLIC_DOMAIN: "web-production.up.railway.app",
      }),
    ).toBe("https://zerometro.exemplo.com");
  });

  test("sem PUBLIC_URL, usa o domínio da Railway com https", () => {
    expect(resolvePublicUrl({ ...base, RAILWAY_PUBLIC_DOMAIN: "web.up.railway.app" })).toBe(
      "https://web.up.railway.app",
    );
  });

  test("em produção, sem URL pública, falha em vez de cair em localhost", () => {
    expect(() => resolvePublicUrl(base)).toThrow("Defina PUBLIC_URL");
  });

  test("em dev, cai em localhost na porta do servidor", () => {
    expect(resolvePublicUrl({ NODE_ENV: "development", PORT: 3000 })).toBe("http://localhost:3000");
  });
});

describe("tokenProblem", () => {
  test("exige o token, com pelo menos 32 caracteres", () => {
    expect(tokenProblem(undefined)).toContain("mise run token");
    expect(tokenProblem("curto")).toContain("32 caracteres");
    expect(tokenProblem("a".repeat(32))).toBeNull();
  });
});
