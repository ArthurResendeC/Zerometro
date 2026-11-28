import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createAuth, SESSION_COOKIE } from "../auth";
import { games, invites, libraryEntries, user } from "../db/schema";
import { bumpSessionVersion, createInvite } from "../services/users";
import {
  createTestApp,
  createTestClock,
  sessionCookie,
  TEST_PASSWORD,
  TEST_TOKEN,
} from "../testing";

const OWNER_SESSION = {
  userId: "owner",
  name: "Dono",
  handle: "owner",
  avatar: "flame",
  role: "admin",
  hasPassword: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("login do admin com o token", () => {
  test("token certo: cookie de sessão de 30 dias, HttpOnly e Lax; abre a API", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/api/auth/login", json({ token: TEST_TOKEN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OWNER_SESSION);

    const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(header).toContain("Max-Age=2592000");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Secure"); // http://localhost nos testes

    const cookie = sessionCookie(res)!;
    expect((await app.request("/api/library", { headers: { cookie } })).status).toBe(200);
    const session = await app.request("/api/auth/session", { headers: { cookie } });
    expect(await session.json()).toEqual(OWNER_SESSION);
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
    }).issueSession({ id: "owner", sessionVersion: 0 });

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

const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const signupBody = (handle: string) =>
  post({ name: handle, handle, avatar: "cat", password: TEST_PASSWORD });

describe("convites", () => {
  test("o link mostra quem convidou e cria o perfil já logado", async () => {
    const { app, db, clock } = await createTestApp();
    const { code } = createInvite(db, { userId: "owner", now: clock.now() }, { note: "pro João" });

    const preview = await app.request(`/api/auth/invites/${code}`);
    expect(await preview.json()).toEqual({ kind: "signup", invitedBy: "Dono" });

    const res = await app.request(
      `/api/auth/invites/${code}/signup`,
      post({ name: "João", handle: " Joao_92 ", avatar: "slime", password: TEST_PASSWORD }),
    );
    expect(res.status).toBe(200);
    const session = (await res.json()) as { userId: string };
    expect(session).toMatchObject({
      name: "João",
      handle: "joao_92",
      avatar: "slime",
      role: "member",
      hasPassword: true,
    });
    const cookie = sessionCookie(res)!;
    const me = await app.request("/api/auth/session", { headers: { cookie } });
    expect(((await me.json()) as { userId: string }).userId).toBe(session.userId);

    const row = db.select().from(invites).get()!;
    expect(row.usedBy).toBe(session.userId);
    expect(row.tokenHash).not.toBe(code);
  });

  test("usado, revogado, vencido ou inventado: 410, sem criar perfil", async () => {
    const { app, db, clock } = await createTestApp();
    const who = { userId: "owner", now: clock.now() };

    const used = createInvite(db, who, {}).code;
    expect((await app.request(`/api/auth/invites/${used}/signup`, signupBody("umm"))).status).toBe(
      200,
    );
    const revoked = createInvite(db, who, {});
    db.update(invites)
      .set({ revokedAt: clock.now().toISOString() })
      .where(eq(invites.id, revoked.id))
      .run();
    const expired = createInvite(db, who, {}).code;
    clock.set(new Date(clock.now().getTime() + 8 * DAY_MS));

    const codes = [used, revoked.code, expired, "inventado"];
    const previews = await Promise.all(
      codes.map((code) => app.request(`/api/auth/invites/${code}`)),
    );
    expect(previews.map((res) => res.status)).toEqual([410, 410, 410, 410]);
    const answers = await Promise.all(
      codes.map((code) => app.request(`/api/auth/invites/${code}/signup`, signupBody("dois"))),
    );
    const bodies = await Promise.all(answers.map((res) => res.json()));
    expect(answers.map((res) => res.status)).toEqual([410, 410, 410, 410]);
    for (const body of bodies) {
      expect((body as { error: { code: string } }).error.code).toBe("invalid_invite");
    }
    expect(db.select({ id: user.id }).from(user).all()).toHaveLength(2);
  });

  test("@apelido já usado: 409 e o convite continua valendo", async () => {
    const { app, db, clock, createMember } = await createTestApp();
    await createMember("joao");
    const { code } = createInvite(db, { userId: "owner", now: clock.now() }, {});
    const taken = await app.request(
      `/api/auth/invites/${code}/signup`,
      post({ name: "Outro", handle: "JOAO", avatar: "cat", password: TEST_PASSWORD }),
    );
    expect(taken.status).toBe(409);
    const ok = await app.request(
      `/api/auth/invites/${code}/signup`,
      post({ name: "Outro", handle: "joao2", avatar: "cat", password: TEST_PASSWORD }),
    );
    expect(ok.status).toBe(200);
  });

  test("senha curta ou avatar inexistente: 400", async () => {
    const { app, db, clock } = await createTestApp();
    const { code } = createInvite(db, { userId: "owner", now: clock.now() }, {});
    const short = post({ name: "A", handle: "aaa", avatar: "cat", password: "curta" });
    expect((await app.request(`/api/auth/invites/${code}/signup`, short)).status).toBe(400);
    const avatar = post({ name: "A", handle: "aaa", avatar: "dragao", password: TEST_PASSWORD });
    expect((await app.request(`/api/auth/invites/${code}/signup`, avatar)).status).toBe(400);
  });

  test("link de redefinição: senha nova e os aparelhos antigos saem", async () => {
    const { app, db, clock, createMember } = await createTestApp();
    const joao = await createMember("joao");
    const { code } = createInvite(
      db,
      { userId: "owner", now: clock.now() },
      { kind: "reset", targetUserId: joao.userId },
    );
    expect(await (await app.request(`/api/auth/invites/${code}`)).json()).toEqual({
      kind: "reset",
      name: "joao",
      handle: "joao",
    });
    // Convite de redefinição não cria perfil.
    const signup = post({ name: "x", handle: "xxx", avatar: "cat", password: TEST_PASSWORD });
    expect((await app.request(`/api/auth/invites/${code}/signup`, signup)).status).toBe(410);

    const res = await app.request(
      `/api/auth/invites/${code}/reset`,
      post({ password: "senha-nova-123" }),
    );
    expect(res.status).toBe(200);
    expect((await joao.request("/api/library")).status).toBe(401);
    expect(
      (await app.request("/api/auth/login", post({ handle: "joao", password: TEST_PASSWORD })))
        .status,
    ).toBe(401);
    expect(
      (await app.request("/api/auth/login", post({ handle: "joao", password: "senha-nova-123" })))
        .status,
    ).toBe(200);
  });
});

describe("login com @apelido e senha", () => {
  test("certo: cookie do perfil; errado ou inexistente: a mesma resposta", async () => {
    const { app, createMember } = await createTestApp();
    const joao = await createMember("joao");

    const ok = await app.request(
      "/api/auth/login",
      post({ handle: "JOAO", password: TEST_PASSWORD }),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { userId: string }).userId).toBe(joao.userId);

    const wrong = await app.request(
      "/api/auth/login",
      post({ handle: "joao", password: "errada!!" }),
    );
    const missing = await app.request(
      "/api/auth/login",
      post({ handle: "ninguem", password: "errada!!" }),
    );
    expect([wrong.status, missing.status]).toEqual([401, 401]);
    const expected = {
      error: { code: "invalid_credentials", message: "@apelido ou senha incorretos" },
    };
    expect([await wrong.json(), await missing.json()]).toEqual([expected, expected]);
    expect([sessionCookie(wrong), sessionCookie(missing)]).toEqual([undefined, undefined]);
  });

  test("o admin sem senha só entra pelo token", async () => {
    const { app } = await createTestApp();
    const res = await app.request(
      "/api/auth/login",
      post({ handle: "owner", password: "qualquer-uma" }),
    );
    expect(res.status).toBe(401);
  });

  test("10 erros seguidos no mesmo perfil: 429 até a janela passar", async () => {
    const { app, clock, createMember } = await createTestApp();
    await createMember("joao");
    // IPs diferentes: conta pelo perfil.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.request(
          "/api/auth/login",
          post({ handle: "joao", password: "errada!!" }, { "x-forwarded-for": `10.0.0.${i}` }),
        ),
      ),
    );
    const blocked = await app.request(
      "/api/auth/login",
      post({ handle: "joao", password: TEST_PASSWORD }),
    );
    expect(blocked.status).toBe(429);
    clock.set(new Date(clock.now().getTime() + 16 * 60 * 1000));
    const later = await app.request(
      "/api/auth/login",
      post({ handle: "joao", password: TEST_PASSWORD }),
    );
    expect(later.status).toBe(200);
  });
});

describe("perfis isolados", () => {
  test("o cookie de um perfil só vê os dados dele", async () => {
    const { db, request, createMember } = await createTestApp();
    const game = db.insert(games).values({ igdbId: 1, name: "Hades" }).returning().get();
    db.insert(libraryEntries).values({ userId: "owner", gameId: game.id, status: "playing" }).run();
    const joao = await createMember("joao");

    type List = { items: unknown[] };
    expect(((await (await request("/api/library")).json()) as List).items).toHaveLength(1);
    expect(((await (await joao.request("/api/library")).json()) as List).items).toEqual([]);
  });

  test("versão da sessão nova (trocou a senha, saiu de todos): os cookies antigos param", async () => {
    const { db, createMember } = await createTestApp();
    const joao = await createMember("joao");
    expect((await joao.request("/api/library")).status).toBe(200);
    bumpSessionVersion(db, joao.userId);
    expect((await joao.request("/api/library")).status).toBe(401);
  });

  test("perfil suspenso: 401 no cookie e no login", async () => {
    const { app, db, createMember } = await createTestApp();
    const joao = await createMember("joao");
    db.update(user)
      .set({ disabledAt: "2026-11-20T00:00:00.000Z" })
      .where(eq(user.id, joao.userId))
      .run();
    expect((await joao.request("/api/library")).status).toBe(401);
    const login = await app.request(
      "/api/auth/login",
      post({ handle: "joao", password: TEST_PASSWORD }),
    );
    expect(login.status).toBe(401);
  });

  test("cookie de antes dos perfis (sem uid): 401, é só entrar de novo", async () => {
    const { app, auth } = await createTestApp();
    const [, signature] = auth.issueSession({ id: "owner", sessionVersion: 0 }).split(".");
    const old = Buffer.from(JSON.stringify({ iat: 0, exp: 9_999_999_999 })).toString("base64url");
    const res = await app.request("/api/library", {
      headers: { cookie: `${SESSION_COOKIE}=${old}.${signature}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("SESSION_SECRET", () => {
  test("com ele, trocar o token não derruba os cookies", () => {
    const base = { publicUrl: "http://localhost:3000", sessionSecret: "segredo-fixo" };
    const a = createAuth({ ...base, token: "token-a".repeat(6) });
    const b = createAuth({ ...base, token: "token-b".repeat(6) });
    const cookie = a.issueSession({ id: "owner", sessionVersion: 0 });
    expect(b.checkSession(cookie)?.id).toBe("owner");
  });
});
