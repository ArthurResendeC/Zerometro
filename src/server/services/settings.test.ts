import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { activityLog } from "../db/schema";
import { createTestContext } from "../testing";
import { setKv } from "./kv";
import { getSettings, updateSettings } from "./settings";

describe("settings", () => {
  test("padrão: ofensiva a partir de 30min", () => {
    expect(getSettings(createTestContext().db)).toEqual({
      streakMinMinutes: 30,
      longSessionMinutes: 360,
    });
  });

  test("atualiza, persiste e registra no activity_log", () => {
    const ctx = createTestContext();
    expect(updateSettings(ctx, { streakMinMinutes: 45 })).toMatchObject({
      streakMinMinutes: 45,
      longSessionMinutes: 360,
    });
    expect(getSettings(ctx.db).streakMinMinutes).toBe(45);
    expect(ctx.db.select().from(activityLog).all()).toMatchObject([
      { action: "settings.update", payload: { streakMinMinutes: 45 } },
    ]);
  });

  test("valor salvo inválido ou JSON quebrado cai no padrão", () => {
    const { db } = createTestContext();
    setKv(db, "settings", JSON.stringify({ streakMinMinutes: 5 }));
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
    setKv(db, "settings", "{oops");
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
