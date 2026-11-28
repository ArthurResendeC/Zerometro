import { describe, expect, test } from "bun:test";
import type { CreatedInvite, InviteSummary, UserSummary } from "../../shared/auth";
import { createTestApp, sessionCookie, TEST_PASSWORD, TEST_TOKEN } from "../testing";

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

describe("/api/me", () => {
  test("muda nome e avatar; avatar inexistente é 400", async () => {
    const { createMember } = await createTestApp();
    const joao = await createMember("joao");
    const res = await joao.request("/api/me", send("PATCH", { name: "João Pedro", avatar: "cat" }));
    expect(await res.json()).toMatchObject({ name: "João Pedro", avatar: "cat", handle: "joao" });
    expect((await joao.request("/api/me", send("PATCH", { avatar: "dragao" }))).status).toBe(400);
    expect((await joao.request("/api/me", send("PATCH", {}))).status).toBe(400);
  });

  test("trocar a senha pede a atual, mantém este aparelho e derruba os outros", async () => {
    const { app, createMember } = await createTestApp();
    const joao = await createMember("joao");
    const login = () =>
      app.request("/api/auth/login", send("POST", { handle: "joao", password: TEST_PASSWORD }));
    const otherDevice = sessionCookie(await login())!;

    const wrong = await joao.request(
      "/api/me/password",
      send("POST", { current: "errada!!", password: "senha-nova-123" }),
    );
    expect(wrong.status).toBe(403);

    const res = await joao.request(
      "/api/me/password",
      send("POST", { current: TEST_PASSWORD, password: "senha-nova-123" }),
    );
    expect(res.status).toBe(200);
    const thisDevice = sessionCookie(res)!;
    expect((await app.request("/api/library", { headers: { cookie: thisDevice } })).status).toBe(
      200,
    );
    expect((await app.request("/api/library", { headers: { cookie: otherDevice } })).status).toBe(
      401,
    );
    expect((await login()).status).toBe(401);
  });

  test("o admin sem senha define uma sem a atual e passa a entrar com @owner", async () => {
    const { app, request } = await createTestApp();
    const res = await request("/api/me/password", send("POST", { password: "senha-do-admin" }));
    expect(((await res.json()) as { hasPassword: boolean }).hasPassword).toBe(true);
    const login = await app.request(
      "/api/auth/login",
      send("POST", { handle: "owner", password: "senha-do-admin" }),
    );
    expect(login.status).toBe(200);
    // O token continua valendo para emergências.
    const token = await app.request("/api/auth/login", send("POST", { token: TEST_TOKEN }));
    expect(token.status).toBe(200);
  });

  test("sair de todos os aparelhos", async () => {
    const { app, createMember } = await createTestApp();
    const joao = await createMember("joao");
    const res = await joao.request("/api/me/sign-out-everywhere", send("POST"));
    expect(res.status).toBe(200);
    expect((await joao.request("/api/library")).status).toBe(401);
    const current = sessionCookie(res)!;
    expect((await app.request("/api/library", { headers: { cookie: current } })).status).toBe(200);
  });
});

describe("/api/admin", () => {
  test("só o admin entra", async () => {
    const { createMember } = await createTestApp();
    const joao = await createMember("joao");
    expect((await joao.request("/api/admin/users")).status).toBe(403);
    expect((await joao.request("/api/admin/invites", send("POST", {}))).status).toBe(403);
  });

  test("convidar: o link abre o convite; a lista mostra o status e quem usou", async () => {
    const { app, request } = await createTestApp();
    const res = await request("/api/admin/invites", send("POST", { note: "pro João" }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as CreatedInvite;
    expect(created.url).toStartWith("http://localhost:3000/convite/");
    const code = created.url.split("/").at(-1)!;

    const second = (await (
      await request("/api/admin/invites", send("POST", {}))
    ).json()) as CreatedInvite;
    expect((await request(`/api/admin/invites/${second.id}`, send("DELETE"))).status).toBe(204);

    await app.request(
      `/api/auth/invites/${code}/signup`,
      send("POST", { name: "João", handle: "joao", avatar: "cat", password: TEST_PASSWORD }),
    );
    const invites = (await (await request("/api/admin/invites")).json()) as InviteSummary[];
    expect(invites.map(({ id, status, note, user }) => ({ id, status, note, user }))).toEqual([
      { id: second.id, status: "revoked", note: null, user: null },
      { id: created.id, status: "used", note: "pro João", user: { name: "João", handle: "joao" } },
    ]);
    // Convite usado não se revoga.
    expect((await request(`/api/admin/invites/${created.id}`, send("DELETE"))).status).toBe(409);
  });

  test("lista os perfis com o último dia jogado; suspende e reativa", async () => {
    const { request, createMember } = await createTestApp();
    const joao = await createMember("joao");
    const users = (await (await request("/api/admin/users")).json()) as UserSummary[];
    expect(users.map((u) => [u.handle, u.role, u.disabled, u.lastPlayedOn])).toEqual([
      ["owner", "admin", false, null],
      ["joao", "member", false, null],
    ]);

    await request(`/api/admin/users/${joao.userId}/disable`, send("POST"));
    expect((await joao.request("/api/library")).status).toBe(401);
    await request(`/api/admin/users/${joao.userId}/enable`, send("POST"));
    expect((await joao.request("/api/library")).status).toBe(200);

    expect((await request("/api/admin/users/owner/disable", send("POST"))).status).toBe(409);
    expect((await request("/api/admin/users/ninguem/disable", send("POST"))).status).toBe(404);
  });

  test("link de redefinição de senha para um amigo", async () => {
    const { app, request, createMember } = await createTestApp();
    const joao = await createMember("joao");
    const res = await request(`/api/admin/users/${joao.userId}/reset-link`, send("POST"));
    const { url } = (await res.json()) as CreatedInvite;
    const code = url.split("/").at(-1)!;
    expect(await (await app.request(`/api/auth/invites/${code}`)).json()).toMatchObject({
      kind: "reset",
      handle: "joao",
    });
  });
});
