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
const list = (items: string[] | undefined) => items?.join(", ") || "—";
const companiesWith = (role: "developer" | "publisher") =>
  list(details?.companies.filter((c) => c[role]).map((c) => c.name));
console.log(`  gêneros: ${list(details?.genres)}`);
console.log(`  temas: ${list(details?.themes)} · modos: ${list(details?.gameModes)}`);
console.log(`  perspectivas: ${list(details?.perspectives)}`);
console.log(
  `  desenvolvedora: ${companiesWith("developer")} · publisher: ${companiesWith("publisher")}`,
);
console.log(
  `  série: ${list(details?.collections.map((c) => c.name))}` +
    ` · franquia: ${list(details?.franchises.map((f) => f.name))}`,
);
console.log(`  capa: ${first.coverImageId ? coverUrl(first.coverImageId) : "—"}`);
console.log(
  ttb
    ? `  tempo para zerar: história ${hours(ttb.mainSec)} · + extras ${hours(ttb.extraSec)} · 100% ${hours(ttb.completeSec)}`
    : "  tempo para zerar: sem dados no IGDB",
);
