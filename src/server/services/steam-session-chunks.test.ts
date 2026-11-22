import { describe, expect, test } from "bun:test";
import { groupSteamChunks, placeSteamChunk } from "./steam-session-chunks";

const at = (iso: string) => new Date(iso);
const min = (n: number) => n * 60_000;

describe("placeSteamChunk", () => {
  const from = at("2026-11-22T03:00:00Z");
  const to = at("2026-11-22T04:00:00Z");

  test("sem sessão anterior: começa `pedaço` antes de agora", () => {
    expect(placeSteamChunk({ minutes: 20, from, to }, null)).toEqual({
      extend: false,
      minutes: 20,
      startedAt: at("2026-11-22T03:40:00Z"),
      endedAt: to,
    });
  });

  test("aberta + pedaço cheio: continua aberta", () => {
    const previous = { minutes: 90, endedAt: from };
    expect(placeSteamChunk({ minutes: 55, from, to }, previous)).toEqual({
      extend: true,
      minutes: 145,
      startedAt: new Date(to.getTime() - min(145)),
      endedAt: to,
    });
  });

  test("aberta + pedaço menor: parou no meio da janela", () => {
    const previous = { minutes: 90, endedAt: from };
    expect(placeSteamChunk({ minutes: 15, from, to }, previous)).toEqual({
      extend: true,
      minutes: 105,
      startedAt: at("2026-11-22T01:30:00Z"),
      endedAt: at("2026-11-22T03:15:00Z"),
    });
  });

  test("fechada há tempo: sessão nova", () => {
    const previous = { minutes: 30, endedAt: at("2026-11-22T02:00:00Z") };
    expect(placeSteamChunk({ minutes: 30, from, to }, previous).extend).toBe(false);
  });

  test("Steam atrasada (pedaço maior que a janela) continua a fechada recente", () => {
    const previous = { minutes: 31, endedAt: at("2026-11-22T03:50:00Z") };
    const late = { minutes: 42, from: at("2026-11-22T03:58:00Z"), to: at("2026-11-22T04:15:00Z") };
    expect(placeSteamChunk(late, previous)).toMatchObject({ extend: true, minutes: 73 });
  });
});

describe("groupSteamChunks", () => {
  test("as sessões reais do Phantom Blade Zero (uma por hora) viram três", () => {
    const chunks = [
      [1, "2026-11-21T07:46:27Z"],
      [30, "2026-11-21T08:46:27Z"],
      [42, "2026-11-21T09:03:37Z"],
      [30, "2026-11-21T22:46:27Z"],
      [60, "2026-11-21T23:46:27Z"],
      [60, "2026-11-22T00:46:27Z"],
      [60, "2026-11-22T01:46:27Z"],
      [10, "2026-11-22T02:46:27Z"],
      [30, "2026-11-22T03:46:27Z"],
      [60, "2026-11-22T04:46:27Z"],
      [60, "2026-11-22T05:46:27Z"],
      [56, "2026-11-22T06:46:27Z"],
      [22, "2026-11-22T07:40:39Z"],
    ] as const;
    const { groupOf, sessions } = groupSteamChunks(
      chunks.map(([minutes, iso]) => ({ minutes, syncedAt: at(iso) })),
    );
    expect(groupOf).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(
      sessions.map((s) => [s.minutes, s.startedAt.toISOString(), s.endedAt.toISOString()]),
    ).toEqual([
      [73, "2026-11-21T07:50:37.000Z", "2026-11-21T09:03:37.000Z"],
      // 19:16–22:56 em São Paulo: a parte das 23:46 (10 min) não encheu a janela.
      [220, "2026-11-21T22:16:27.000Z", "2026-11-22T01:56:27.000Z"],
      // 00:20–04:08 em São Paulo.
      [228, "2026-11-22T03:20:27.000Z", "2026-11-22T07:08:27.000Z"],
    ]);
  });
});
