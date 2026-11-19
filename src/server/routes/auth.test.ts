import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../../shared/library";
import { createAuthGateway, LEGACY_OWNER_ID } from "../auth";
import { createTestDb } from "../db/client";
import { games, kv, libraryEntries, playSessions, user } from "../db/schema";
import { createTestApp, TEST_EMAILS } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("autenticação", () => {
  test("API exige sessão; health e rotas da Better Auth são públicas", async () => {
    const { app, request } = await createTestApp();

    const anonymous = await app.request("/api/library");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({
      error: { code: "unauthorized", message: "Entre para continuar" },
    });
    expect((await app.request("/api/health")).status).toBe(200);
    expect(await (await app.request("/api/auth/ok")).json()).toEqual({ ok: true });

    expect((await request("/api/library")).status).toBe(200);
    const session = await request("/api/auth/get-session");
    expect(await session.json()).toMatchObject({ user: { email: TEST_EMAILS.owner } });
  });

  test("cookie inválido → 401", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/api/library", {
      headers: { cookie: "better-auth.session_token=forjado.assinatura" },
    });
    expect(res.status).toBe(401);
  });

  test("e-mail fora da lista de convidados não cria conta", async () => {
    const { loginAs } = await createTestApp();
    await expect(loginAs("intruso@zerometro.test")).rejects.toThrow(
      "Esse e-mail não está na lista de convidados",
    );
  });

  test("quem sai da lista de convidados perde o acesso na hora", async () => {
    const { auth, loginAs } = await createTestApp();
    const friend = await loginAs(TEST_EMAILS.friend);

    expect((await friend.request("/api/library")).status).toBe(200);
    const onlyOwner = createAuthGateway(auth, [TEST_EMAILS.owner]);
    expect(await onlyOwner.getUserId(friend.headers)).toBeNull();
  });

  test("cada convidado vê só a própria biblioteca", async () => {
    const { request, loginAs } = await createTestApp();
    await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const friend = await loginAs(TEST_EMAILS.friend);

    const res = await friend.request("/api/library");
    expect(((await res.json()) as { items: LibraryItem[] }).items).toEqual([]);
  });

  test("o dono adota os dados de antes do login no primeiro acesso", async () => {
    // Estado depois da migration 0002 num banco que já tinha dados.
    const db = createTestDb();
    db.insert(user)
      .values({ id: LEGACY_OWNER_ID, name: "Legado", email: "legacy-owner@zerometro.invalid" })
      .run();
    const [game] = db
      .insert(games)
      .values({ igdbId: 114283, name: "Persona 5 Royal" })
      .returning()
      .all();
    if (!game) throw new Error("jogo não criado");
    db.insert(libraryEntries)
      .values({ userId: LEGACY_OWNER_ID, gameId: game.id, status: "playing" })
      .run();
    db.insert(playSessions)
      .values({ userId: LEGACY_OWNER_ID, gameId: game.id, playedOn: "2026-11-18", minutes: 90 })
      .run();
    db.insert(kv)
      .values({ key: `settings:${LEGACY_OWNER_ID}`, value: '{"streakMinMinutes":45}' })
      .run();

    const { request, loginAs } = await createTestApp({ db });

    const library = (await (await request("/api/library")).json()) as { items: LibraryItem[] };
    expect(library.items).toMatchObject([{ name: "Persona 5 Royal", minutesPlayed: 90 }]);
    expect(await (await request("/api/settings")).json()).toMatchObject({
      settings: { streakMinMinutes: 45 },
    });
    expect(
      db
        .select()
        .from(user)
        .all()
        .map((u) => u.id),
    ).not.toContain(LEGACY_OWNER_ID);

    // Outros convidados não herdam nada.
    const friend = await loginAs(TEST_EMAILS.friend);
    const friendLibrary = (await (await friend.request("/api/library")).json()) as {
      items: LibraryItem[];
    };
    expect(friendLibrary.items).toEqual([]);
  });
});
