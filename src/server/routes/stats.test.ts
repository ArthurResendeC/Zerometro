import { describe, expect, test } from "bun:test";
import type { Settings } from "../../shared/settings";
import type { Stats } from "../../shared/stats";
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
});
