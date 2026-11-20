import { linkSteamProfileSchema } from "../../shared/steam";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import type { SteamAutoSyncState, SteamProfile } from "../../shared/steam";
import {
  getAutoSyncState,
  getSteamProfile,
  linkSteamProfile,
  unlinkSteamProfile,
} from "../services/steam-account";
import { autoSyncSteam, syncSteamLibrary } from "../services/steam-sync";

/** A conta Steam do usuário: perfil e sincronização de todos os jogos. */
export function createSteamRoutes(deps: AppDeps) {
  const syncDeps = { catalog: deps.achievements, igdb: deps.igdb, steamUser: deps.steamUser };
  const body = (profile: SteamProfile | null, auto: SteamAutoSyncState | null) => ({
    enabled: deps.steamUser.enabled,
    profile,
    auto,
  });

  return (
    createRouter()
      .get("/profile", (c) => {
        const ctx = webContext(deps, c);
        return c.json(body(getSteamProfile(ctx), getAutoSyncState(ctx)));
      })
      .put("/profile", validate("json", linkSteamProfileSchema), async (c) => {
        const profile = await linkSteamProfile(
          webContext(deps, c),
          deps.steamUser,
          c.req.valid("json"),
        );
        return c.json(body(profile, null));
      })
      .delete("/profile", (c) => {
        unlinkSteamProfile(webContext(deps, c));
        return c.json(body(null, null));
      })
      .post("/sync", async (c) => c.json(await syncSteamLibrary(webContext(deps, c), syncDeps)))
      // Chamado pelo app ao abrir e ao voltar ao primeiro plano; o servidor decide se roda.
      .post("/sync/auto", async (c) => c.json(await autoSyncSteam(webContext(deps, c), syncDeps)))
  );
}
