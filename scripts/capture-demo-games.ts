// Congela as páginas de jogo (aba "Sobre") do demo: `mise run demo:capture`.
// Busca no IGDB real (credenciais do .env) os jogos da biblioteca do demo e das listas de
// "Descobrir" e grava em scripts/demo-game-pages.json, que o seed põe no cache. Assim o demo
// mostra as páginas completas sem credenciais do IGDB.
import { writeFileSync } from "node:fs";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { createIgdbFromEnv } from "../src/server/services/igdb";
import type { FeedGame } from "../src/shared/feeds";
import type { IgdbGamePage } from "../src/shared/game-page";
import demoFeeds from "./demo-feeds.json";
import { GAMES } from "./demo-library";

const igdb = createIgdbFromEnv(db, env);
const ids = [
  ...new Set([
    ...Object.values(GAMES).map(([igdbId]) => igdbId),
    ...Object.values(demoFeeds as Record<string, FeedGame[]>).flatMap((games) =>
      games.map((g) => g.igdbId),
    ),
  ]),
];

// Um de cada vez, de propósito: o IGDB aceita 4 requisições por segundo, e cada página faz duas.
const pages: IgdbGamePage[] = [];
for (const id of ids) {
  // oxlint-disable-next-line no-await-in-loop
  const page = await igdb.getGamePage(id);
  if (page) pages.push(page);
  console.log(`${pages.length}/${ids.length} ${page?.name ?? `${id} não encontrado`}`);
  // oxlint-disable-next-line no-await-in-loop
  await Bun.sleep(600);
}

// Um jogo por linha: o diff de uma recaptura fica legível.
const out = new URL("./demo-game-pages.json", import.meta.url);
writeFileSync(out, `[\n${pages.map((p) => JSON.stringify(p)).join(",\n")}\n]\n`);
console.log(`\n${pages.length} páginas em scripts/demo-game-pages.json`);
