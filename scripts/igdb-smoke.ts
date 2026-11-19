// Teste manual contra o IGDB real: `mise run igdb:smoke [termo]`.
// Usa as credenciais do .env e guarda o token no banco local (tabela kv). Não grava jogos.
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { createIgdbFromEnv } from "../src/server/services/igdb";
import { coverUrl } from "../src/shared/igdb";

const term = process.argv.slice(2).join(" ") || "persona 5 royal";
const igdb = createIgdbFromEnv(db, env);

const hours = (sec: number | null) => (sec === null ? "—" : `${(sec / 3600).toFixed(1)}h`);

console.log(`Buscando "${term}"…\n`);
const results = await igdb.searchGames(term, 5);
for (const game of results) {
  console.log(
    `  ${game.igdbId}\t${game.name} (${game.releaseYear ?? "?"}) [${game.gameType ?? "?"}]` +
      ` · ${game.platforms.join(", ")}`,
  );
}

const first = results[0];
if (!first) {
  console.log("Nenhum resultado.");
  process.exit(0);
}

const details = await igdb.getGame(first.igdbId);
const ttb = details?.timeToBeat;
console.log(`\nDetalhes de ${first.name}:`);
console.log(`  gêneros: ${details?.genres.join(", ") || "—"}`);
console.log(`  capa: ${first.coverImageId ? coverUrl(first.coverImageId) : "—"}`);
console.log(
  ttb
    ? `  tempo para zerar: história ${hours(ttb.mainSec)} · + extras ${hours(ttb.extraSec)} · 100% ${hours(ttb.completeSec)}`
    : "  tempo para zerar: sem dados no IGDB",
);
