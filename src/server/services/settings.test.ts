import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { activityLog } from "../db/schema";
import { ItemNotOwnedError } from "../errors";
import { grantItem } from "./items";
import { createTestContext } from "../testing";
import { setKv } from "./kv";
import { getSettings, updateSettings } from "./settings";

describe("settings", () => {
  test("padrão: ofensiva a partir de 30min", () => {
    expect(getSettings(createTestContext())).toEqual({
      streakMinMinutes: 30,
      longSessionMinutes: 360,
      ratingMode: "blend",
      ratingBlendWeight: 0.7,
      ratingCustomWeights: null,
      shareWithGroup: true,
      groupSections: {},
      themeId: "cartucho",
      soundPackId: null,
    });
  });

  test("atualiza, persiste e registra no activity_log", () => {
    const ctx = createTestContext();
    expect(updateSettings(ctx, { streakMinMinutes: 45 })).toMatchObject({
      streakMinMinutes: 45,
      longSessionMinutes: 360,
    });
    expect(getSettings(ctx).streakMinMinutes).toBe(45);
    expect(ctx.db.select().from(activityLog).all()).toMatchObject([
      { action: "settings.update", payload: { streakMinMinutes: 45 } },
    ]);
  });

  test("valor salvo inválido ou JSON quebrado cai no padrão", () => {
    const ctx = createTestContext();
    setKv(ctx.db, `settings:${ctx.userId}`, JSON.stringify({ streakMinMinutes: 5 }));
    expect(getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
    setKv(ctx.db, `settings:${ctx.userId}`, "{oops");
    expect(getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  });

  describe("tema e pacote de sons", () => {
    test("só aceita o que o perfil tem", () => {
      const ctx = createTestContext();
      expect(() => updateSettings(ctx, { themeId: "minimal" })).toThrow(ItemNotOwnedError);
      expect(() => updateSettings(ctx, { soundPackId: "minimal" })).toThrow(
        "Você ainda não tem o pacote de sons Toques do Minimal",
      );
      grantItem(ctx, ctx.userId, { kind: "theme", itemId: "minimal" }, "grant");
      expect(updateSettings(ctx, { themeId: "minimal", soundPackId: "minimal" })).toMatchObject({
        themeId: "minimal",
        soundPackId: "minimal",
      });
      expect(getSettings(ctx)).toMatchObject({ themeId: "minimal", soundPackId: "minimal" });
    });

    test("o tema base e o pacote dele são de todo mundo", () => {
      const ctx = createTestContext();
      expect(updateSettings(ctx, { themeId: "cartucho", soundPackId: "cartucho" })).toMatchObject({
        themeId: "cartucho",
        soundPackId: "cartucho",
      });
    });

    test("tema salvo que o perfil não tem mais volta ao padrão", () => {
      const ctx = createTestContext();
      setKv(
        ctx.db,
        `settings:${ctx.userId}`,
        JSON.stringify({ themeId: "ladrao-fantasma", soundPackId: "ladrao-fantasma" }),
      );
      expect(getSettings(ctx)).toMatchObject({ themeId: "cartucho", soundPackId: null });
    });
  });
});
