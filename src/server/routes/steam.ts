import {
  linkSteamProfileSchema,
  steamImportSchema,
  steamSyncGamesSchema,
} from "../../shared/steam";
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
import { importSteamGames, previewSteamImport } from "../services/steam-import";
import {
  autoSyncSteam,
  getSteamLibrarySyncRun,
  startSteamLibrarySync,
  syncSteamLibrary,
} from "../services/steam-sync";

/** A conta Steam do usuário: perfil, sincronização de todos os jogos e importação da conta. */
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
      // "Sincronizar tudo": começa em segundo plano e responde na hora; o app acompanha pelo GET.
      .post("/sync", (c) => c.json(startSteamLibrarySync(webContext(deps, c), syncDeps)))
      .get("/sync", (c) => c.json({ run: getSteamLibrarySyncRun(webContext(deps, c)) }))
      // Chamado pelo app ao abrir e ao voltar ao primeiro plano; o servidor decide se roda.
      .post("/sync/auto", async (c) => c.json(await autoSyncSteam(webContext(deps, c), syncDeps)))
      // Só alguns jogos: as conquistas dos que acabaram de ser importados, em lotes.
      .post("/sync/games", validate("json", steamSyncGamesSchema), async (c) =>
        c.json(
          await syncSteamLibrary(webContext(deps, c), syncDeps, {
            gameIds: c.req.valid("json").gameIds,
          }),
        ),
      )
      .get("/import", async (c) => c.json(await previewSteamImport(webContext(deps, c), syncDeps)))
      .post("/import", validate("json", steamImportSchema), async (c) =>
        c.json(await importSteamGames(webContext(deps, c), syncDeps, c.req.valid("json"))),
      )
  );
}
