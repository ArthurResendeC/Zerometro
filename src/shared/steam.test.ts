import { describe, expect, test } from "bun:test";
import { parseSteamProfile } from "./steam";

describe("parseSteamProfile", () => {
  test("SteamID64, URLs do perfil e nome da URL personalizada", () => {
    expect(parseSteamProfile("76561197960435530")).toEqual({ steamId: "76561197960435530" });
    expect(parseSteamProfile("https://steamcommunity.com/profiles/76561197960435530/")).toEqual({
      steamId: "76561197960435530",
    });
    expect(parseSteamProfile("steamcommunity.com/id/robinwalker")).toEqual({
      vanity: "robinwalker",
    });
    expect(parseSteamProfile("https://steamcommunity.com/id/Robin_W-1/?l=brazilian")).toEqual({
      vanity: "Robin_W-1",
    });
    expect(parseSteamProfile(" robinwalker ")).toEqual({ vanity: "robinwalker" });
  });

  test("o que não é perfil → null", () => {
    expect(parseSteamProfile("https://store.steampowered.com/app/504230")).toBeNull();
    expect(parseSteamProfile("steamcommunity.com/profiles/123")).toBeNull();
    expect(parseSteamProfile("um nome com espaço")).toBeNull();
    expect(parseSteamProfile("")).toBeNull();
  });
});
