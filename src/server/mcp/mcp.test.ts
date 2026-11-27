import { beforeEach, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { activityLog } from "../db/schema";
import {
  createFakeIgdb,
  createFakeSteamUser,
  createTestApp,
  fakeFeedGame,
  fakeIgdbGame,
  TEST_BASE_URL,
  TEST_TODAY,
  TEST_TOKEN,
} from "../testing";

// Fluxo completo de um conector MCP (como o do claude.ai): descoberta → registro dinâmico →
// consentimento com o token da instância → token → chamadas de tools, tudo contra o app de teste.

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const MCP_URL = `${TEST_BASE_URL}/mcp`;

const igdb = createFakeIgdb(
  [
    fakeIgdbGame(),
    fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
    fakeIgdbGame({ igdbId: 1, name: "Pokémon Red" }),
    fakeIgdbGame({ igdbId: 2, name: "Pokémon Blue" }),
  ],
  {
    trending: [fakeFeedGame(), fakeFeedGame({ igdbId: 999, name: "Novidade" })],
  },
);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp({ igdb });
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const ids = (res: { data: { games: { gameId: number }[] } }) => res.data.games.map((g) => g.gameId);

async function discover(app: TestApp) {
  const prm = (await (await app.fetchRoot("/.well-known/oauth-protected-resource/mcp")).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  const metadata = (await (
    await app.fetchRoot("/.well-known/oauth-authorization-server")
  ).json()) as Record<string, string>;
  return { prm, metadata };
}

/** Faz o fluxo OAuth inteiro (o dono aprova com o token) e devolve o access token. */
async function authorize(app: TestApp): Promise<string> {
  const { metadata } = await discover(app);
  const registered = (await (
    await app.fetchRoot(
      metadata.registration_endpoint ?? "",
      json({
        client_name: "Claude",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
      }),
    )
  ).json()) as { client_id: string };

  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: REDIRECT_URI,
    state: "estado",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_URL,
  });
  const consent = await app.fetchRoot(metadata.authorization_endpoint ?? "", {
    method: "POST",
    body: new URLSearchParams([...query, ["decision", "allow"], ["token", TEST_TOKEN]]),
  });
  const callback = new URL(consent.headers.get("location") ?? "");
  expect(callback.searchParams.get("state")).toBe("estado");

  const token = (await (
    await app.fetchRoot(metadata.token_endpoint ?? "", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code") ?? "",
        redirect_uri: REDIRECT_URI,
        client_id: registered.client_id,
        code_verifier: verifier,
        resource: MCP_URL,
      }),
    })
  ).json()) as { access_token: string; refresh_token?: string };
  expect(token.refresh_token).toBeString(); // o conector renova sozinho
  return token.access_token;
}

async function connect(app: TestApp, accessToken: string) {
  const client = new Client({ name: "teste", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (input, init) => app.fetchRoot(String(input), init),
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

async function callJson(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { isError: Boolean(result.isError), text: first?.text ?? "", data: tryJson(first?.text) };
}

function tryJson(text: string | undefined): any {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
}

describe("descoberta OAuth", () => {
  test("/mcp sem token → 401 apontando para os metadados do recurso", async () => {
    const res = await t.fetchRoot("/mcp", json({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${TEST_BASE_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  test("metadados do recurso e do servidor de autorização, com registro dinâmico", async () => {
    const { prm, metadata } = await discover(t);
    expect(prm.resource).toBe(MCP_URL);
    expect(metadata).toMatchObject({
      issuer: TEST_BASE_URL,
      registration_endpoint: `${TEST_BASE_URL}/register`,
      authorization_endpoint: `${TEST_BASE_URL}/authorize`,
      token_endpoint: `${TEST_BASE_URL}/token`,
    });
  });
});

describe("tools", () => {
  test("token de um convidado: lê a biblioteca, os jogos e as estatísticas dele", async () => {
    await t.request("/api/library", json({ igdbId: 114283, status: "playing" }));
    await t.request("/api/library", json({ igdbId: 1, status: "finished" }));
    await t.request("/api/library", json({ igdbId: 2, status: "backlog" }));
    await t.request("/api/sessions", json({ gameId: 1, minutes: 45 }));

    const client = await connect(t, await authorize(t));

    const { tools } = await client.listTools();
    const readOnly = tools
      .filter((tool) => tool.annotations?.readOnlyHint)
      .map((tool) => tool.name);
    expect(readOnly.toSorted()).toEqual([
      "get_active_session",
      "get_feeds",
      "get_game",
      "get_period_stats",
      "get_profile",
      "get_recap",
      "get_stats",
      "get_timeline",
      "list_achievements",
      "list_library",
      "list_objectives",
      "list_sessions",
      "list_steam_import",
      "search_igdb",
      "suggest_next",
    ]);
    // Só as que apagam conclusões e objetivos (e elas pedem confirm: true).
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint);
    expect(destructive.map((tool) => tool.name).toSorted()).toEqual([
      "delete_objective",
      "remove_completion",
    ]);

    const playing = await callJson(client, "list_library", { status: "playing" });
    expect(playing.data.games.map((g: { name: string }) => g.name)).toEqual(["Persona 5 Royal"]);

    // Por nota: a maior primeiro; sem nota no fim, nas duas direções.
    await t.request("/api/library/1", { ...json({ rating: 7 }), method: "PATCH" });
    await t.request("/api/library/3", { ...json({ rating: 9 }), method: "PATCH" });
    expect(ids(await callJson(client, "list_library", { sort: "rating" }))).toEqual([3, 1, 2]);
    expect(ids(await callJson(client, "list_library", { sort: "rating", order: "asc" }))).toEqual([
      1, 3, 2,
    ]);

    const game = await callJson(client, "get_game", { game: "persona" });
    expect(game.data).toMatchObject({ name: "Persona 5 Royal", minutesPlayed: 45 });
    expect(game.data.recentSessions).toHaveLength(1);

    // "pokemon" (sem acento) bate com dois: devolve as opções em vez de chutar.
    const ambiguous = await callJson(client, "get_game", { game: "pokemon" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("Pokémon Red");
    expect(ambiguous.text).toContain("Pokémon Blue");

    const exact = await callJson(client, "get_game", { game: "pokemon blue" });
    expect(exact.data).toMatchObject({ name: "Pokémon Blue", status: "backlog" });

    const missing = await callJson(client, "get_game", { game: "zelda" });
    expect(missing).toMatchObject({ isError: true });

    const stats = await callJson(client, "get_stats");
    expect(stats.data).toMatchObject({ todayMinutes: 45 });

    const period = await callJson(client, "get_period_stats", {});
    expect(period.data).toMatchObject({ totalMinutes: 45, playedDays: 1, sessions: 1 });
    expect(period.data.topGames[0]).toMatchObject({ name: "Persona 5 Royal", minutes: 45 });
    expect(period.data.weekdays).toHaveLength(7);

    const timeline = await callJson(client, "get_timeline", {});
    const persona = timeline.data.games.find((g: { name: string }) => g.name === "Persona 5 Royal");
    expect(persona).toMatchObject({ minutes: 45, statusLabel: "Jogando", pauses: [] });
    expect(persona.spans).toEqual([expect.objectContaining({ minutes: 45, playedDays: 1 })]);
    expect(persona).not.toHaveProperty("coverImageId");

    // Perfil: entram o Persona (45 min) e o Pokémon Red (zerado, sem tempo); o próximo, não. O
    // fake credita a todos a mesma dev (Atlus) e a mesma série (Persona).
    const profile = await callJson(client, "get_profile", {});
    expect(profile.data).toMatchObject({ sort: "minutes", gamesCounted: 2, totalHours: 0.8 });
    expect(profile.data.developers).toEqual([
      expect.objectContaining({ name: "Atlus", games: 2, finished: 1 }),
    ]);
    expect(profile.data.series[0].topGames).toEqual(["Persona 5 Royal", "Pokémon Red"]);

    // O que jogar: só o Persona está em andamento; o próximo vem depois, o zerado não entra.
    const suggested = await callJson(client, "suggest_next", { available: "short" });
    expect(suggested.data.suggestions.map((g: { name: string }) => g.name)).toEqual([
      "Persona 5 Royal",
      "Pokémon Blue",
    ]);
    const picked = await callJson(client, "suggest_next", { random: true });
    expect(picked.data).toMatchObject({ poolSize: 2 });
    expect((await callJson(client, "suggest_next", { mood: "coop" })).data.suggestions).toEqual([]);

    // Recap da semana atual (a sessão é de hoje), com a imagem junto.
    const recap = await client.callTool({
      name: "get_recap",
      arguments: { period: "week", date: "2026-11-19", image: true, format: "wide" },
    });
    const [recapText, recapImage] = recap.content as {
      type: string;
      text?: string;
      data?: string;
    }[];
    expect(JSON.parse(recapText!.text!)).toMatchObject({
      period: "week",
      from: "2026-11-16",
      totalMinutes: 45,
      inProgress: true,
    });
    expect(recapImage).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(recapImage!.data!, "base64").readUInt32BE(16)).toBe(1920);

    // Um slide só (sempre stories); um slide que não está no recap (o vazio, com sessão) é erro.
    const slide = await client.callTool({
      name: "get_recap",
      arguments: { period: "week", date: "2026-11-19", image: true, slide: "games" },
    });
    const slideImage = (slide.content as { data?: string }[])[1];
    expect(Buffer.from(slideImage!.data!, "base64").readUInt32BE(16)).toBe(1080);
    const noSlide = await client.callTool({
      name: "get_recap",
      arguments: { period: "week", date: "2026-11-19", image: true, slide: "empty" },
    });
    expect(noSlide.isError).toBe(true);

    const sessions = await callJson(client, "list_sessions", { game: 1 });
    expect(sessions.data.sessions).toHaveLength(1);

    expect((await callJson(client, "get_active_session")).data).toEqual({ active: null });

    const feeds = await callJson(client, "get_feeds", { list: "trending" });
    expect(feeds.data.lists).toHaveLength(1);
    expect(feeds.data.lists[0].games).toMatchObject([
      { name: "Persona 5 Royal", inLibrary: { gameId: 1 } },
      { name: "Novidade", inLibrary: null },
    ]);

    const search = await callJson(client, "search_igdb", { query: "undertale" });
    expect(search.data.results[0]).toMatchObject({ igdbId: 12517, name: "Undertale" });

    await client.close();
  });

  test("escrita: adiciona jogo, timer, registra sessão e muda status, como actor mcp", async () => {
    const client = await connect(t, await authorize(t));

    const added = await callJson(client, "add_game", { igdbId: 12517 });
    expect(added.data).toMatchObject({ name: "Undertale", status: "backlog" });
    expect((await callJson(client, "add_game", { igdbId: 12517 })).isError).toBe(true);
    await callJson(client, "add_game", {
      igdbId: 114283,
      status: "playing",
      platformPlayed: "PS5",
    });

    // Timer: começa em Undertale (Próximos → Jogando), não troca sozinho de jogo.
    const started = await callJson(client, "start_session", { game: "undertale" });
    expect(started.data).toMatchObject({
      active: { gameName: "Undertale" },
      alreadyRunning: false,
      statusChangedTo: "playing",
    });
    const again = await callJson(client, "start_session", { game: "undertale" });
    expect(again.data.alreadyRunning).toBe(true);
    const busy = await callJson(client, "start_session", { game: "persona" });
    expect(busy.isError).toBe(true);
    expect(busy.text).toContain("replaceActive");

    t.clock.set(new Date(t.clock.now().getTime() + 50 * 60_000));
    const stopped = await callJson(client, "stop_session", { note: "Ruínas" });
    expect(stopped.data).toMatchObject({
      discarded: false,
      session: { minutes: 50, note: "Ruínas", source: "timer" },
      dayTotalMinutes: 50,
    });
    expect((await callJson(client, "stop_session")).isError).toBe(true);

    // "Onde parei": a nota do stop aparece no jogo, e set_session_note troca depois.
    const undertale = await callJson(client, "get_game", { game: "undertale" });
    expect(undertale.data.lastNote).toMatchObject({ note: "Ruínas" });
    const noted = await callJson(client, "set_session_note", {
      game: "undertale",
      note: "Snowdin, antes do Papyrus",
    });
    expect(noted.data).toMatchObject({ minutes: 50, note: "Snowdin, antes do Papyrus" });
    const listed = await callJson(client, "list_library", { query: "undertale" });
    expect(listed.data.games[0].lastNote.note).toBe("Snowdin, antes do Papyrus");

    // Sessão sem timer: fonte "mcp", soma no dia e no jogo.
    const logged = await callJson(client, "log_session", { game: "persona", minutes: 90 });
    expect(logged.data).toMatchObject({
      session: { minutes: 90, source: "mcp" },
      dayTotalMinutes: 140,
      gameTotalMinutes: 90,
    });
    expect(
      (await callJson(client, "log_session", { game: "persona", minutes: 2000 })).isError,
    ).toBe(true);

    const finished = await callJson(client, "set_status", {
      game: "undertale",
      status: "finished",
    });
    expect(finished.data).toMatchObject({
      status: "finished",
      previousStatus: "playing",
      finishedAt: TEST_TODAY,
    });

    // Tudo aparece no site e no histórico com actor "mcp".
    const { items } = (await (await t.request("/api/library")).json()) as {
      items: { name: string; status: string }[];
    };
    expect(items.find((item) => item.name === "Undertale")?.status).toBe("finished");
    const actors = t.db.select({ actor: activityLog.actor }).from(activityLog).all();
    expect(new Set(actors.map((row) => row.actor))).toEqual(new Set(["mcp"]));

    await client.close();
  });

  test("tempo anterior: add_game e set_prior_playtime, fora das estatísticas", async () => {
    const client = await connect(t, await authorize(t));

    const added = await callJson(client, "add_game", {
      igdbId: 114283,
      status: "playing",
      priorMinutes: 600,
    });
    expect(added.data).toMatchObject({ minutesPlayed: 600, priorMinutes: 600 });

    const updated = await callJson(client, "set_prior_playtime", {
      game: "persona",
      minutes: 39 * 60,
    });
    expect(updated.data).toMatchObject({
      minutesPlayed: 2340,
      priorMinutes: 2340,
      status: "playing",
    });
    expect(
      (await callJson(client, "set_prior_playtime", { game: "persona", minutes: -5 })).isError,
    ).toBe(true);

    const stats = await callJson(client, "get_stats");
    expect(stats.data.totalMinutes).toBe(0);

    await client.close();
  });

  test("conclusões: zerei continuando a jogar (pós-jogo), platinei e apagar com confirmação", async () => {
    const client = await connect(t, await authorize(t));
    await callJson(client, "add_game", { igdbId: 114283, status: "playing" });

    const zerei = await callJson(client, "mark_completed", { game: "persona" });
    expect(zerei.data).toMatchObject({
      completion: { type: "main", completedOn: TEST_TODAY },
      game: { status: "playing", displayState: "postgame", displayStateLabel: "Pós-jogo" },
      previousStatus: "playing",
    });
    expect(zerei.data.hint).toContain("set_status");

    const postgame = await callJson(client, "list_library", { display_state: "postgame" });
    expect(postgame.data.games.map((g: { name: string }) => g.name)).toEqual(["Persona 5 Royal"]);

    const platinei = await callJson(client, "mark_completed", {
      game: "persona",
      type: "full",
      date: "2026-11-18",
      move_to_finished: true,
    });
    expect(platinei.data.game).toMatchObject({
      status: "finished",
      completion: { best: "full", bestLabel: "100%", count: 2 },
    });
    expect(
      (await callJson(client, "mark_completed", { game: "persona", date: "2030-01-01" })).isError,
    ).toBe(true);

    const details = await callJson(client, "get_game", { game: "persona" });
    expect(details.data.completions.map((c: { type: string }) => c.type)).toEqual(["main", "full"]);
    const { id } = details.data.completions[0];

    // Sem confirm: só mostra o que apagaria.
    const preview = await callJson(client, "remove_completion", { completion_id: id });
    expect(preview.data).toMatchObject({ confirmationNeeded: true, wouldDelete: { id } });
    expect((await callJson(client, "get_game", { game: "persona" })).data.completions).toHaveLength(
      2,
    );

    const removed = await callJson(client, "remove_completion", {
      completion_id: id,
      confirm: true,
    });
    expect(removed.data).toMatchObject({ removed: { id }, game: { completion: { count: 1 } } });

    await client.close();
  });

  test("objetivos: criar contador, incrementar, concluir e sugerir 100%; apagar com confirmação", async () => {
    const client = await connect(t, await authorize(t));
    await callJson(client, "add_game", { igdbId: 114283, status: "playing" });

    const korok = await callJson(client, "add_objective", {
      game: "persona",
      title: "Sementes Korok",
      target: 900,
    });
    expect(korok.data).toMatchObject({ objective: { progress: 0, target: 900, done: false } });
    const id = korok.data.objective.id;

    const mais10 = await callJson(client, "update_objective", { objective_id: id, increment: 10 });
    expect(mais10.data.objective.progress).toBe(10);

    const ambiguous = await callJson(client, "update_objective", {
      objective_id: id,
      increment: 1,
      done: true,
    });
    expect(ambiguous.isError).toBe(true);
    expect((await callJson(client, "update_objective", { objective_id: id })).isError).toBe(true);

    const done = await callJson(client, "update_objective", { objective_id: id, done: true });
    expect(done.data).toMatchObject({
      objective: { progress: 900, done: true },
      allDoneNow: true,
      suggestFullCompletion: true,
    });
    expect(done.data.hint).toContain("mark_completed");

    const listed = await callJson(client, "list_objectives", { game: "persona" });
    expect(listed.data).toMatchObject({ summary: { total: 1, unlocked: 1 } });

    const preview = await callJson(client, "delete_objective", { objective_id: id });
    expect(preview.data.confirmationNeeded).toBe(true);
    const deleted = await callJson(client, "delete_objective", { objective_id: id, confirm: true });
    expect(deleted.data).toMatchObject({ deleted: { id }, summary: { total: 0 } });

    await client.close();
  });

  test("conquistas: liga a da Steam pelo IGDB, lista sem spoiler, marca pelo nome e sugere 100%", async () => {
    const client = await connect(t, await authorize(t));
    await callJson(client, "add_game", { igdbId: 114283, status: "playing" });

    const empty = await callJson(client, "list_achievements", { game: "persona" });
    expect(empty.data.hint).toContain("link_achievement_set");

    const ra = await callJson(client, "link_achievement_set", {
      game: "persona",
      source: "retroachievements",
    });
    expect(ra.data).toMatchObject({ linked: false, candidates: [] });

    const linked = await callJson(client, "link_achievement_set", {
      game: "persona",
      source: "steam",
    });
    expect(linked.data).toMatchObject({ linked: true, summary: { total: 3, unlocked: 0 } });

    const listed = await callJson(client, "list_achievements", { game: "persona" });
    const secret = listed.data.sets[0].achievements[2];
    expect(secret).toMatchObject({ title: null, description: null, secret: true });

    const one = await callJson(client, "set_achievement", {
      game: "persona",
      achievement: "primeiro palacio",
      date: "2026-11-01",
    });
    expect(one.data.achievements[0]).toMatchObject({ title: "Primeiro palácio", unlocked: true });

    await callJson(client, "set_achievement", { game: "persona", achievement: "Confidente" });
    const last = await callJson(client, "set_achievement", {
      game: "persona",
      achievement: "Final verdadeiro",
    });
    expect(last.data).toMatchObject({ allDoneNow: true, suggestFullCompletion: true });
    expect(last.data.hint).toContain("mark_completed");

    const missing = await callJson(client, "set_achievement", {
      game: "persona",
      achievement: "zzz",
    });
    expect(missing.isError).toBe(true);

    const game = await callJson(client, "get_game", { game: "persona" });
    expect(game.data.achievements).toMatchObject({ total: 3, unlocked: 3 });
    expect(game.data.achievementSets[0]).toMatchObject({ source: "steam", unlocked: 3 });

    await client.close();
  });

  test("steam: sem perfil dá a dica; sincroniza um jogo e usa o tempo da Steam", async () => {
    t = await createTestApp({
      igdb,
      steamUser: createFakeSteamUser({
        owned: { 1687950: 3000 },
        unlocked: { 1687950: [{ apiName: "ACH_1", unlockedAt: null }] },
      }),
    });
    const client = await connect(t, await authorize(t));
    await callJson(client, "add_game", { igdbId: 114283, status: "playing" });

    const unlinked = await callJson(client, "sync_steam", { game: "persona" });
    expect(unlinked.isError).toBe(true);
    expect(unlinked.text).toContain("Ajustes");

    await t.request("/api/steam/profile", { ...json({ profile: "robinwalker" }), method: "PUT" });
    const synced = await callJson(client, "sync_steam", { game: "persona" });
    expect(synced.data.sync).toMatchObject({ newUnlocks: 1, steamMinutes: 3000, linkedSet: true });
    expect(synced.data.game).toMatchObject({
      playtimeSource: "sessions",
      steamPlaytime: { minutes: 3000 },
      achievements: { total: 3, unlocked: 1 },
    });

    const steam = await callJson(client, "set_playtime_source", {
      game: "persona",
      source: "steam",
    });
    expect(steam.data).toMatchObject({ playtimeSource: "steam", minutesPlayed: 3000 });

    const all = await callJson(client, "sync_steam", {});
    expect(all.data).toMatchObject({ newUnlocks: 0, games: [{ name: "Persona 5 Royal" }] });

    await client.close();
  });

  test("steam: lista os jogos da conta fora da biblioteca e importa com as conquistas", async () => {
    t = await createTestApp({
      igdb: createFakeIgdb([
        fakeIgdbGame(),
        fakeIgdbGame({ igdbId: 26226, name: "Celeste", steamAppId: 504230 }),
      ]),
      steamUser: createFakeSteamUser({
        owned: {
          1687950: { minutes: 3000, recentMinutes: 90, lastPlayedAt: null, name: "P5R" },
          504230: 0,
          431960: { minutes: 600, lastPlayedAt: null, name: "Wallpaper Engine" },
        },
        unlocked: { 1687950: [{ apiName: "ACH_1", unlockedAt: null }] },
      }),
    });
    await t.request("/api/steam/profile", { ...json({ profile: "robinwalker" }), method: "PUT" });
    const client = await connect(t, await authorize(t));

    const list = await callJson(client, "list_steam_import");
    expect(list.data).toEqual({
      inLibrary: 0,
      hidesPlaytime: false,
      ignored: 0,
      games: [
        {
          appId: 1687950,
          name: "Persona 5 Royal",
          steamName: "P5R",
          hours: 50,
          recentHours: 1.5,
          suggestedStatus: "playing",
        },
        { appId: 504230, name: "Celeste", hours: 0, suggestedStatus: "backlog" },
      ],
      notInIgdb: ["Wallpaper Engine"],
    });

    const imported = await callJson(client, "import_steam_games", {
      games: [{ app_id: 1687950 }],
      ignore: [504230],
    });
    expect(imported.data).toEqual({
      added: [
        {
          gameId: expect.any(Number),
          name: "Persona 5 Royal",
          status: "playing",
          steamMinutes: 3000,
          newUnlocks: 1,
        },
      ],
      skipped: [],
      ignored: 1,
    });
    const game = await callJson(client, "get_game", { game: "persona" });
    expect(game.data).toMatchObject({ playtimeSource: "steam", minutesPlayed: 3000 });

    const after = await callJson(client, "list_steam_import", { include_ignored: true });
    expect(after.data.games).toEqual([
      { appId: 504230, name: "Celeste", hours: 0, suggestedStatus: "backlog", ignored: true },
    ]);

    await client.close();
  });

  test("o token da instância como Bearer também conecta (ex.: claude mcp add --header)", async () => {
    await t.request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const client = await connect(t, TEST_TOKEN);
    const { games } = (await callJson(client, "list_library")).data;
    expect(games.map((g: { name: string }) => g.name)).toEqual(["Persona 5 Royal"]);
    await client.close();
  });

  test("token inválido → 401", async () => {
    const res = await t.fetchRoot("/mcp", {
      ...json({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: { "content-type": "application/json", authorization: "Bearer lixo" },
    });
    expect(res.status).toBe(401);
  });
});
