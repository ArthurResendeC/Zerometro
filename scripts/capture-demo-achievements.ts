// Congela no demo as listas de conquistas reais: `mise run demo:capture-achievements`.
// Busca na Steam (STEAM_WEB_API_KEY do .env) e grava em scripts/demo-achievements.json, que o
// seed põe no banco e liga ao jogo. Só os dados da lista (nomes, descrições, raridade e os links
// dos ícones no CDN da Steam), nada de imagens.
// O RetroAchievements fica de fora até os termos dele serem lidos (ver o plano de conquistas).
import { writeFileSync } from "node:fs";
import { env } from "../src/server/env";
import { createSteamFromEnv } from "../src/server/services/steam";
import type { GameKey } from "./demo-library";

/** Jogo do demo → appid na Steam. */
const STEAM: [GameKey, number][] = [["celeste", 504230]];

const steam = createSteamFromEnv(env);
if (!steam.enabled) {
  console.error("Defina STEAM_WEB_API_KEY no .env para capturar.");
  process.exit(1);
}

const captured = [];
for (const [game, appId] of STEAM) {
  // oxlint-disable-next-line no-await-in-loop
  const set = await steam.getAchievementSet(appId);
  if (!set) {
    console.log(`${game}: a Steam não tem conquistas para o app ${appId}`);
    continue;
  }
  captured.push({ game, set });
  console.log(`${game}: ${set.achievements.length} conquistas`);
}

const out = new URL("./demo-achievements.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(captured, null, 2)}\n`);
console.log(`\n${captured.length} listas em scripts/demo-achievements.json`);
