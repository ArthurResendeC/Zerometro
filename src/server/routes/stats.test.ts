import { describe, expect, test } from "bun:test";
import type { Settings } from "../../shared/settings";
import type { Heatmap, PeriodBreakdown, Records, Rhythm, Stats } from "../../shared/stats";
import { createTestApp } from "../testing";

function patch(body: unknown): RequestInit {
  return {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("/api/settings e /api/stats", () => {
  test("o mínimo da ofensiva aceita de 10min a 12h", async () => {
    const { request } = await createTestApp();

    const invalid = await Promise.all(
      [9, 721, 30.5, undefined].map((streakMinMinutes) =>
        request("/api/settings", patch({ streakMinMinutes })),
      ),
    );
    expect(invalid.map((res) => res.status)).toEqual([400, 400, 400, 400]);

    const ok = await request("/api/settings", patch({ streakMinMinutes: 720 }));
    expect(((await ok.json()) as { settings: Settings }).settings.streakMinMinutes).toBe(720);
  });

  test("stats usam o mínimo configurado", async () => {
    const { request } = await createTestApp();
    await request("/api/settings", patch({ streakMinMinutes: 15 }));

    const res = await request("/api/stats");
    expect(res.status).toBe(200);
    const stats = (await res.json()) as Stats;
    expect(stats.streak).toMatchObject({ minMinutes: 15, current: 0, todayRemainingMinutes: 15 });
  });

  test("heatmap aceita um ano opcional", async () => {
    const { request } = await createTestApp();

    const rolling = (await (await request("/api/stats/heatmap")).json()) as Heatmap;
    expect(rolling).toMatchObject({ year: null, from: "2025-11-17", days: [] });

    const year = (await (await request("/api/stats/heatmap?year=2025")).json()) as Heatmap;
    expect(year).toMatchObject({ year: 2025, from: "2025-01-01", to: "2025-12-31" });

    expect((await request("/api/stats/heatmap?year=abc")).status).toBe(400);
  });

  test("detalhamento do período", async () => {
    const { request } = await createTestApp();
    const res = await request("/api/stats/breakdown?year=2026");
    expect(res.status).toBe(200);
    expect((await res.json()) as PeriodBreakdown).toMatchObject({
      year: 2026,
      genres: [],
      games: [],
      totalMinutes: 0,
    });
    expect((await request("/api/stats/breakdown?year=1999")).status).toBe(400);
  });

  test("ritmo", async () => {
    const { request } = await createTestApp();
    const rhythm = (await (await request("/api/stats/rhythm")).json()) as Rhythm;
    expect(rhythm.weekdays).toHaveLength(7);
    expect(rhythm.hours).toHaveLength(24);
    expect(rhythm).toMatchObject({ sessions: 0, sessionLengths: [0, 0, 0, 0, 0] });
  });

  test("recordes", async () => {
    const { request } = await createTestApp();
    const records = (await (await request("/api/stats/records?year=2026")).json()) as Records;
    expect(records).toMatchObject({ year: 2026, longestSession: null, finished: [] });
    expect(records.finishedByMonth).toHaveLength(11); // até novembro (hoje)
  });
});
