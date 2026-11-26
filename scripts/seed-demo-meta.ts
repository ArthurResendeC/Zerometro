import { eq } from "drizzle-orm";
import type { Tx } from "../src/server/db/client";
import { games } from "../src/server/db/schema";
import { type GameLinks, IGDB_META_VERSION, saveGameLinks } from "../src/server/services/games";
import type { IgdbGameDetails } from "../src/shared/igdb";
import demoGameMeta from "./demo-game-meta.json";

// Metadados congelados do IGDB (capturados por capture-demo-meta.ts) aplicados aos jogos do demo.

export type DemoGameMeta = Pick<
  IgdbGameDetails,
  "igdbId" | "themes" | "gameModes" | "perspectives"
> &
  GameLinks;

export function seedDemoMeta(tx: Tx): void {
  for (const meta of demoGameMeta as DemoGameMeta[]) {
    const game = tx
      .update(games)
      .set({
        themes: meta.themes,
        gameModes: meta.gameModes,
        perspectives: meta.perspectives,
        metaVersion: IGDB_META_VERSION,
      })
      .where(eq(games.igdbId, meta.igdbId))
      .returning({ id: games.id })
      .get();
    if (game) saveGameLinks(tx, game.id, meta);
  }
}
