// Congela os metadados do IGDB dos jogos do demo (temas, modos, perspectivas, empresas e séries):
// `mise run demo:capture-meta`. Grava scripts/demo-game-meta.json, que o seed põe nas tabelas, para
// o perfil de gamer do demo funcionar sem credenciais do IGDB.
import { writeFileSync } from "node:fs";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { createIgdbFromEnv } from "../src/server/services/igdb";
import { GAMES } from "./demo-library";
import type { DemoGameMeta } from "./seed-demo-meta";

const igdb = createIgdbFromEnv(db, env);
const details = await igdb.getGames(Object.values(GAMES).map(([igdbId]) => igdbId));
const meta: DemoGameMeta[] = details
  .map(({ igdbId, themes, gameModes, perspectives, companies, collections, franchises }) => ({
    igdbId,
    themes,
    gameModes,
    perspectives,
    companies,
    collections,
    franchises,
  }))
  .toSorted((a, b) => a.igdbId - b.igdbId);

// Um jogo por linha: o diff de uma recaptura fica legível.
const out = new URL("./demo-game-meta.json", import.meta.url);
writeFileSync(out, `[\n${meta.map((m) => JSON.stringify(m)).join(",\n")}\n]\n`);
console.log(`${meta.length} jogos em scripts/demo-game-meta.json`);
