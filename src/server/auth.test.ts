import { describe, expect, test } from "bun:test";
import { resolvePublicUrl } from "./auth";

describe("resolvePublicUrl", () => {
  const base = { NODE_ENV: "production", PORT: 8080 };

  test("BETTER_AUTH_URL vence (sem barra no fim)", () => {
    expect(
      resolvePublicUrl({
        ...base,
        BETTER_AUTH_URL: "https://zerometro.exemplo.com/",
        RAILWAY_PUBLIC_DOMAIN: "web-production.up.railway.app",
      }),
    ).toBe("https://zerometro.exemplo.com");
  });

  test("sem BETTER_AUTH_URL, usa o domínio da Railway com https", () => {
    expect(resolvePublicUrl({ ...base, RAILWAY_PUBLIC_DOMAIN: "web.up.railway.app" })).toBe(
      "https://web.up.railway.app",
    );
  });

  test("em produção, sem URL pública, falha em vez de cair em localhost", () => {
    expect(() => resolvePublicUrl(base)).toThrow("Defina BETTER_AUTH_URL");
  });

  test("em dev, cai em localhost na porta do servidor", () => {
    expect(resolvePublicUrl({ NODE_ENV: "development", PORT: 3000 })).toBe("http://localhost:3000");
  });
});
