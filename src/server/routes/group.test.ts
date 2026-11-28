import { describe, expect, test } from "bun:test";
import type {
  GroupGameEntry,
  GroupLeaderboard,
  GroupMemberGamerProfile,
  GroupMemberProfile,
  GroupMemberStatsView,
} from "../../shared/group";
import { createFakeIgdb, createTestApp, fakeIgdbGame } from "../testing";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("/api/group", () => {
  test("ranking, perfil do amigo, o jogo no grupo e sair do ranking", async () => {
    const { request, createMember } = await createTestApp({
      igdb: createFakeIgdb([fakeIgdbGame()]),
    });
    await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    await request("/api/sessions", json({ gameId: 1, minutes: 60 }));
    const joao = await createMember("joao");

    const board = (await (
      await joao.request("/api/group/leaderboard?period=week")
    ).json()) as GroupLeaderboard;
    expect(board.members.map((m) => [m.handle, m.minutes, m.isMe])).toEqual([
      ["owner", 60, false],
      ["joao", 0, true],
    ]);
    expect((await joao.request("/api/group/leaderboard?period=decada")).status).toBe(400);

    const owner = (await (
      await joao.request("/api/group/members/OWNER")
    ).json()) as GroupMemberProfile;
    expect(owner.playing!.map((g) => g.name)).toEqual(["Persona 5 Royal"]);

    const stats = (await (
      await joao.request("/api/group/members/owner/stats?year=2026")
    ).json()) as GroupMemberStatsView;
    expect(stats.year).toBe(2026);
    expect(stats.timeline).not.toBeNull();
    expect((await joao.request("/api/group/members/owner/stats?year=1")).status).toBe(400);

    await request("/api/settings", {
      ...json({ groupSections: { genres: false } }),
      method: "PATCH",
    });
    const gamer = (await (
      await joao.request("/api/group/members/owner/profile")
    ).json()) as GroupMemberGamerProfile;
    expect(gamer.genres).toBeNull();
    expect(gamer.series).not.toBeNull();

    const game = (await (await joao.request("/api/group/games/114283")).json()) as GroupGameEntry[];
    expect(game.map((e) => e.member.handle)).toEqual(["owner"]);

    await request("/api/settings", { ...json({ shareWithGroup: false }), method: "PATCH" });
    expect((await joao.request("/api/group/members/owner")).status).toBe(404);
    const after = (await (await request("/api/group/leaderboard")).json()) as GroupLeaderboard;
    expect(after.meHidden).toBe(true);
  });
});
