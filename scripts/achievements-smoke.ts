// Teste manual contra a Steam e o RetroAchievements reais: `mise run achievements:smoke`.
// Usa STEAM_WEB_API_KEY e RA_API_KEY do .env (a fonte sem chave é pulada). Não grava nada.
import { env } from "../src/server/env";
import type { FetchedAchievementSet } from "../src/server/services/achievement-sources";
import { createJsonClient } from "../src/server/services/http-json";
import { createRetroAchievementsFromEnv } from "../src/server/services/retroachievements";
import { RA_CONSOLES } from "../src/shared/ra-consoles";
import { createSteamFromEnv } from "../src/server/services/steam";

const STEAM_APP_ID = 504230; // Celeste
const RA_CONSOLE_ID = 3; // SNES
const RA_TITLE = "Super Metroid";

function show(set: FetchedAchievementSet | null) {
  if (!set) return console.log("  sem conquistas\n");
  const hidden = set.achievements.filter((a) => a.hidden);
  console.log(
    `  ${set.title ?? "(sem nome)"} · ${set.platform ?? "—"} · ${set.achievements.length} conquistas`,
  );
  for (const a of set.achievements.slice(0, 5)) {
    const rarity = a.rarity === null ? "—" : `${a.rarity.toFixed(1)}%`;
    const points = a.points === null ? "" : ` · ${a.points} pts`;
    console.log(
      `    ${a.hidden ? "[oculta] " : ""}${a.title} — ${a.description ?? "(sem descrição)"} · ${rarity}${points}`,
    );
  }
  if (hidden.length > 0) {
    console.log(
      `  ${hidden.length} ocultas; descrição da primeira: ${hidden[0]?.description ?? "(nenhuma)"}`,
    );
  }
  console.log(`  ícone: ${set.achievements[0]?.iconUrl ?? "—"}\n`);
}

const steam = createSteamFromEnv(env);
if (steam.enabled) {
  console.log(`Steam: app ${STEAM_APP_ID}`);
  show(await steam.getAchievementSet(STEAM_APP_ID));
}

const ra = createRetroAchievementsFromEnv(env);
if (ra.enabled) {
  const list = await ra.getGameList(RA_CONSOLE_ID);
  console.log(`RetroAchievements: ${list.length} jogos com conquistas no console ${RA_CONSOLE_ID}`);
  // A tabela fixa de consoles (plataforma do IGDB → console do RA) bate com a API?
  const consoles = await createJsonClient({
    label: "o RetroAchievements",
    baseUrl: "https://retroachievements.org/API/",
    defaultParams: { y: env.RA_API_KEY! },
    minIntervalMs: 500,
  }).get<{ ID: number; Name: string }[]>("API_GetConsoleIDs.php");
  const names = new Map(consoles.map((c) => [c.ID, c.Name]));
  for (const c of RA_CONSOLES) {
    const real = names.get(c.id);
    if (real !== c.name)
      console.log(`  console ${c.id}: tabela diz "${c.name}", API diz "${real ?? "(não existe)"}"`);
  }
  const game = list.find((g) => g.title === RA_TITLE);
  if (game) {
    console.log(`  ${RA_TITLE} = jogo ${game.id}`);
    show(await ra.getAchievementSet(game.id));
  } else {
    console.log(`  ${RA_TITLE} não encontrado na lista\n`);
  }
}

if (!steam.enabled && !ra.enabled) console.log("Nenhuma chave no .env: nada para testar.");
