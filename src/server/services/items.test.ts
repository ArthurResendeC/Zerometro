import { describe, expect, test } from "bun:test";
import { activityLog, userItems } from "../db/schema";
import { NotFoundError } from "../errors";
import { createTestContext, createTestUser } from "../testing";
import { grantItem, listItems, ownedIds, ownsItem } from "./items";

describe("itens", () => {
  test("todo mundo tem o tema base, o pacote de som dele e o Alto Contraste, sem linha no banco", () => {
    const ctx = createTestContext();
    expect(listItems(ctx)).toEqual([
      { kind: "theme", itemId: "cartucho", source: null, acquiredAt: null },
      { kind: "theme", itemId: "alto-contraste", source: null, acquiredAt: null },
      { kind: "sound_pack", itemId: "cartucho", source: null, acquiredAt: null },
    ]);
    expect(ownsItem(ctx, "theme", "cartucho")).toBe(true);
    expect(ownsItem(ctx, "theme", "alto-contraste")).toBe(true);
    expect(ownsItem(ctx, "theme", "minimal")).toBe(false);
    expect(ctx.db.select().from(userItems).all()).toEqual([]);
  });

  test("ganhar um tema traz o pacote de som dele e registra no activity_log", () => {
    const ctx = createTestContext();
    expect(grantItem(ctx, ctx.userId, { kind: "theme", itemId: "minimal" }, "grant")).toEqual({
      created: true,
    });
    expect(ownsItem(ctx, "theme", "minimal")).toBe(true);
    expect(ownsItem(ctx, "sound_pack", "minimal")).toBe(true);
    expect([...ownedIds(ctx, "theme")]).toEqual(["cartucho", "alto-contraste", "minimal"]);
    expect(listItems(ctx).at(-1)).toEqual({
      kind: "sound_pack",
      itemId: "minimal",
      source: "grant",
      acquiredAt: ctx.now.toISOString(),
    });
    expect(ctx.db.select().from(activityLog).all()).toMatchObject([
      {
        action: "item.grant",
        payload: { targetUserId: ctx.userId, kind: "theme", itemId: "minimal", source: "grant" },
      },
    ]);
  });

  test("ganhar de novo não duplica nem registra de novo", () => {
    const ctx = createTestContext();
    grantItem(ctx, ctx.userId, { kind: "theme", itemId: "minimal" }, "grant");
    expect(grantItem(ctx, ctx.userId, { kind: "theme", itemId: "minimal" }, "purchase")).toEqual({
      created: false,
    });
    expect(ctx.db.select().from(userItems).all()).toHaveLength(2);
    expect(ctx.db.select().from(activityLog).all()).toHaveLength(1);
  });

  test("só o pacote de som, sem o tema", () => {
    const ctx = createTestContext();
    grantItem(ctx, ctx.userId, { kind: "sound_pack", itemId: "ladrao-fantasma" }, "gift");
    expect(ownsItem(ctx, "sound_pack", "ladrao-fantasma")).toBe(true);
    expect(ownsItem(ctx, "theme", "ladrao-fantasma")).toBe(false);
  });

  test("a posse é de cada perfil", () => {
    const ctx = createTestContext();
    const friend = createTestUser(ctx.db, "amigo");
    grantItem(ctx, friend, { kind: "theme", itemId: "ladrao-fantasma" }, "grant");
    expect(ownsItem({ db: ctx.db, userId: friend }, "theme", "ladrao-fantasma")).toBe(true);
    expect(ownsItem(ctx, "theme", "ladrao-fantasma")).toBe(false);
  });

  test("perfil que não existe", () => {
    const ctx = createTestContext();
    expect(() => grantItem(ctx, "ninguem", { kind: "theme", itemId: "minimal" }, "grant")).toThrow(
      NotFoundError,
    );
  });
});
