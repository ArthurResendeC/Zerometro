import { linkSteamProfileSchema } from "../../shared/steam";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { getSteamProfile, linkSteamProfile, unlinkSteamProfile } from "../services/steam-account";
import { syncSteamLibrary } from "../services/steam-sync";

/** A conta Steam do usuário: perfil e sincronização de todos os jogos. */
export function createSteamRoutes(deps: AppDeps) {
  return createRouter()
    .get("/profile", (c) =>
      c.json({ enabled: deps.steamUser.enabled, profile: getSteamProfile(webContext(deps, c)) }),
    )
    .put("/profile", validate("json", linkSteamProfileSchema), async (c) => {
      const profile = await linkSteamProfile(
        webContext(deps, c),
        deps.steamUser,
        c.req.valid("json"),
      );
      return c.json({ enabled: deps.steamUser.enabled, profile });
    })
    .delete("/profile", (c) => {
      unlinkSteamProfile(webContext(deps, c));
      return c.json({ enabled: deps.steamUser.enabled, profile: null });
    })
    .post("/sync", async (c) =>
      c.json(
        await syncSteamLibrary(webContext(deps, c), {
          catalog: deps.achievements,
          igdb: deps.igdb,
          steamUser: deps.steamUser,
        }),
      ),
    );
}
