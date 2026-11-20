import { describe, expect, test } from "bun:test";
import { createAuth, SESSION_COOKIE } from "../auth";
import { createTestApp, createTestClock, sessionCookie, TEST_TOKEN } from "../testing";

const DAY_MS = 24 * 60 * 60 * 1000;

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("login com o token", () => {
  test("token certo: cookie de sessão de 30 dias, HttpOnly e Lax; abre a API", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/api/auth/login", json({ token: TEST_TOKEN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "owner" });

    const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(header).toContain("Max-Age=2592000");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Secure"); // http://localhost nos testes

    const cookie = sessionCookie(res)!;
    expect((await app.request("/api/library", { headers: { cookie } })).status).toBe(200);
    const session = await app.request("/api/auth/session", { headers: { cookie } });
    expect(await session.json()).toEqual({ userId: "owner" });
  });

  test("token errado ou vazio: 401/400 e nenhum cookie", async () => {
    const { app } = await createTestApp();
    const wrong = await app.request("/api/auth/login", json({ token: `${TEST_TOKEN}x` }));
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("invalid_token");
    expect(sessionCookie(wrong)).toBeUndefined();

    expect((await app.request("/api/auth/login", json({ token: "  " }))).status).toBe(400);
  });

  test("site com https: o cookie é Secure", async () => {
    const auth = createAuth({ token: TEST_TOKEN, publicUrl: "https://zerometro.exemplo.com" });
    expect(auth.cookieOptions().secure).toBe(true);
  });
});

describe("acesso à API", () => {
  test("sem sessão: 401; health e login são públicos", async () => {
    const { app } = await createTestApp();
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/library")).status).toBe(401);
    expect((await app.request("/api/auth/session")).status).toBe(401);
  });

  test("o token como Bearer também vale (scripts)", async () => {
    const { app } = await createTestApp();
    const ok = await app.request("/api/library", {
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(ok.status).toBe(200);
    const wrong = await app.request("/api/library", {
      headers: { authorization: `Bearer ${TEST_TOKEN}x` },
    });
    expect(wrong.status).toBe(401);
  });

  test("cookie adulterado, de outro token ou vencido: 401", async () => {
    const clock = createTestClock();
    const { app, cookie } = await createTestApp({ clock });
    const [name, value] = cookie.split("=");
    const [payload, signature] = (value ?? "").split(".");
    const forged = Buffer.from(JSON.stringify({ iat: 0, exp: 9_999_999_999 })).toString(
      "base64url",
    );
    const other = createAuth({
      token: "outro-token-de-outra-instancia-com-32-chars",
      publicUrl: "http://localhost:3000",
      now: () => clock.now().getTime(),
    }).issueSession();

    const answers = await Promise.all(
      [`${forged}.${signature}`, `${payload}.x`, other, "lixo"].map((bad) =>
        app.request("/api/library", { headers: { cookie: `${name}=${bad}` } }),
      ),
    );
    expect(answers.map((res) => res.status)).toEqual([401, 401, 401, 401]);

    clock.set(new Date(clock.now().getTime() + 30 * DAY_MS));
    expect((await app.request("/api/library", { headers: { cookie } })).status).toBe(401);
  });

  test("um dia de uso renova o cookie por mais 30 dias", async () => {
    const clock = createTestClock();
    const { app, cookie } = await createTestApp({ clock });

    const sameDay = await app.request("/api/library", { headers: { cookie } });
    expect(sessionCookie(sameDay)).toBeUndefined();

    clock.set(new Date(clock.now().getTime() + 29 * DAY_MS));
    const renewed = sessionCookie(await app.request("/api/library", { headers: { cookie } }));
    expect(renewed).toBeDefined();
    expect(renewed).not.toBe(cookie);

    // 29 dias depois da renovação, o cookie antigo já venceu e o novo ainda vale.
    clock.set(new Date(clock.now().getTime() + 29 * DAY_MS));
    expect((await app.request("/api/library", { headers: { cookie } })).status).toBe(401);
    expect((await app.request("/api/library", { headers: { cookie: renewed! } })).status).toBe(200);
  });

  test("sair apaga o cookie", async () => {
    const { app, cookie } = await createTestApp();
    const res = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(204);
    const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(header).toContain("Max-Age=0");
  });
});
