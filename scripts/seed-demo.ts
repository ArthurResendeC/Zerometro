// Banco de demonstração para prints do README: `mise run demo` (seed + servidor).
// Recria do zero o banco de DATABASE_PATH (só aceita um arquivo com "demo" no nome, para
// nunca apagar dados de verdade) com jogos reais do IGDB, ~10 meses de sessões, uma ofensiva
// em andamento e um timer rodando. As datas são relativas a hoje, então os gráficos sempre
// parecem atuais. Os dados ficam no dono provisório da migration 0002: o primeiro login do
// dono (primeiro e-mail de ALLOWED_EMAILS) adota tudo.
import { rmSync } from "node:fs";
import { basename } from "node:path";
import { LEGACY_OWNER_ID } from "../src/server/auth";
import { createDb, runMigrations } from "../src/server/db/client";
import {
  type NewGame,
  type NewLibraryEntry,
  type NewPlaySession,
  completions,
  games,
  libraryEntries,
  objectives,
  playSessions,
  user,
} from "../src/server/db/schema";
import {
  addDays,
  DEFAULT_TIME_ZONE,
  todayIn,
  zonedParts,
  zonedToInstant,
} from "../src/shared/dates";
import type { CompletionType, GameStatus, SessionSource } from "../src/shared/domain";
import { type FeedGame, type FeedKey, feedKeys } from "../src/shared/feeds";
import { saveFeedSnapshot } from "../src/server/services/feeds";
import { saveGamePage } from "../src/server/services/game-pages";
import type { IgdbGamePage } from "../src/shared/game-page";
import { GAMES, type GameKey, type GameRow } from "./demo-library";
// Listas da home (IGDB, nov/2026) congeladas: o demo roda sem credenciais do IGDB.
import demoFeeds from "./demo-feeds.json";
// Páginas de jogo (aba "Sobre") dos jogos do demo e das listas: `mise run demo:capture`.
import demoGamePages from "./demo-game-pages.json";

const path = process.env.DATABASE_PATH ?? "";
if (!basename(path).includes("demo")) {
  console.error(`Recusado: DATABASE_PATH (${path || "vazio"}) precisa ter "demo" no nome.`);
  process.exit(1);
}

const TZ = DEFAULT_TIME_ZONE;
const now = new Date();
const today = todayIn(TZ, now);

// Gerador pseudoaleatório com semente fixa (mulberry32): mesmo formato de dados a cada seed.
let seed = 33;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
const roundTo5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5);

// ---------------------------------------------------------------------------
// Biblioteca

interface EntrySpec {
  status: GameStatus;
  platform?: string;
  rating?: number;
  notes?: string;
  /** Horas jogadas antes do Zerômetro (sem sessões). */
  priorHours?: number;
}

const LIBRARY: Record<GameKey, EntrySpec> = {
  eldenRing: {
    status: "playing",
    platform: "PS5",
    notes: "Build de força com Greatsword. Falta a Malenia.",
  },
  clairObscur: { status: "playing", platform: "PC" },
  silksong: { status: "playing", platform: "Switch 2" },
  persona5: { status: "playing", platform: "PS5", notes: "Rota da Makoto." },
  bg3: { status: "playing", platform: "PC", notes: "Campanha co-op, ato 2.", priorHours: 25 },
  hades: { status: "finished", platform: "Switch", rating: 10 },
  // Zerada e de volta para os B-sides: pós-jogo.
  celeste: { status: "playing", platform: "Switch", rating: 9, notes: "Faltam os B-sides." },
  hollowKnight: { status: "finished", platform: "Switch", rating: 9 },
  outerWilds: {
    status: "finished",
    platform: "PC",
    rating: 10,
    notes: "Jogar sem spoiler, sempre.",
  },
  discoElysium: { status: "finished", platform: "PC", rating: 9 },
  zeldaTotk: { status: "finished", platform: "Switch", rating: 8 },
  stardew: { status: "paused", platform: "PC", notes: "Ano 2, primavera. Voltar no co-op." },
  deathStranding: { status: "dropped", platform: "PS5" },
  witcher3: { status: "backlog" },
  rdr2: { status: "backlog" },
  sekiro: { status: "backlog" },
  chronoTrigger: { status: "backlog" },
  hades2: { status: "backlog" },
  metroidPrime4: { status: "wishlist" },
  gta6: { status: "wishlist" },
};

// ---------------------------------------------------------------------------
// Sessões

const sessions: (Omit<NewPlaySession, "gameId" | "userId"> & { game: GameKey })[] = [];

/** Sessão encerrada; as de timer ganham início/fim à noite (ou à tarde no fim de semana). */
function addSession(game: GameKey, playedOn: string, minutes: number, source: SessionSource) {
  const weekend = [0, 6].includes(new Date(`${playedOn}T12:00:00Z`).getUTCDay());
  if (source !== "timer") {
    sessions.push({ game, playedOn, minutes, source });
    return;
  }
  const time = `${String(weekend ? between(13, 16) : between(19, 21)).padStart(2, "0")}:${String(between(0, 11) * 5).padStart(2, "0")}`;
  const start = zonedToInstant(playedOn, time, TZ);
  const end = new Date(start.getTime() + minutes * 60_000);
  sessions.push({
    game,
    playedOn,
    minutes,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    source,
  });
}

/** Sessões diárias seguidas, terminando em `lastDay`, até somar `totalMinutes`. */
function addRun(game: GameKey, lastDay: string, totalMinutes: number): string {
  let day = lastDay;
  let left = totalMinutes;
  while (left > 0) {
    if (rand() < 0.75) {
      const minutes = Math.min(left, roundTo5(between(50, 180)));
      addSession(game, day, minutes, rand() < 0.5 ? "timer" : "manual");
      left -= minutes;
    }
    day = addDays(day, -1);
  }
  return addDays(day, 1);
}

const mainMinutes = (key: GameKey) => (GAMES[key][5] ?? 0) / 60;

// Jogos em andamento: últimas 10 semanas, com uma ofensiva de 12 dias até ontem (hoje o
// timer está rodando) e, antes dela, um dia de folga.
const STREAK_DAYS = 12;
const WINDOW_DAYS = 70;
/** Progresso (da história) que cada jogo em andamento deve atingir até hoje. */
const playingTargets: [GameKey, number][] = [
  ["eldenRing", 0.72],
  ["persona5", 0.35],
  ["clairObscur", 0.55],
  ["silksong", 0.45],
  ["bg3", 0.12],
];
const remaining = new Map(playingTargets.map(([key, target]) => [key, mainMinutes(key) * target]));
const firstPlayed = new Map<GameKey, string>();

/** Sorteia um jogo em andamento com chance proporcional ao que falta para a meta dele. */
function pickPlaying(): GameKey {
  const weights = playingTargets.map(([key]) => Math.max(remaining.get(key)!, 30));
  let r = rand() * weights.reduce((sum, w) => sum + w, 0);
  for (const [i, [key]] of playingTargets.entries()) {
    if ((r -= weights[i]!) < 0) return key;
  }
  return playingTargets[0]![0];
}

for (let ago = WINDOW_DAYS; ago >= 1; ago--) {
  const day = addDays(today, -ago);
  const inStreak = ago <= STREAK_DAYS;
  if (ago === STREAK_DAYS + 1) continue;
  if (!inStreak && rand() < 0.3) continue;

  const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
  const total = weekend ? between(120, 300) : between(40, 150);
  const parts = total > 100 && rand() < 0.5 ? 2 : 1;
  for (let i = 0; i < parts; i++) {
    const game = pickPlaying();
    if (!firstPlayed.has(game)) firstPlayed.set(game, day);
    // Algumas sessões registradas pelo Claude (MCP), o resto pelo timer ou à mão.
    const source = rand() < 0.1 ? "mcp" : rand() < 0.75 ? "timer" : "manual";
    const minutes = roundTo5(total / parts);
    remaining.set(game, remaining.get(game)! - minutes);
    addSession(game, day, minutes, source);
  }
}

// Zerados: um atrás do outro antes da janela, do mais recente (Hades) ao mais antigo.
const finishedDates = new Map<GameKey, { startedAt: string; finishedAt: string }>();
let cursor = addDays(today, -(WINDOW_DAYS + 4));
for (const key of [
  "hades",
  "celeste",
  "hollowKnight",
  "outerWilds",
  "discoElysium",
  "zeldaTotk",
] as const) {
  const finishedAt = cursor;
  const startedAt = addRun(key, finishedAt, roundTo5(mainMinutes(key) * (1.05 + rand() * 0.3)));
  finishedDates.set(key, { startedAt, finishedAt });
  cursor = addDays(startedAt, -between(3, 12));
}

// Pausado e abandonado: um pouco de tempo jogado lá atrás.
const stardewStart = addRun("stardew", addDays(today, -160), 960);
const deathStrandingStart = addRun("deathStranding", addDays(today, -110), 420);

// ---------------------------------------------------------------------------
// Grava

rmSync(path, { force: true });
rmSync(`${path}-wal`, { force: true });
rmSync(`${path}-shm`, { force: true });
const db = createDb(path);
runMigrations(db);

db.transaction((tx) => {
  tx.insert(user)
    .values({
      id: LEGACY_OWNER_ID,
      name: "Dados anteriores ao login",
      email: "legacy-owner@zerometro.invalid",
    })
    .run();

  const gameIds = new Map<GameKey, number>();
  for (const [key, row] of Object.entries(GAMES) as [GameKey, GameRow][]) {
    const [
      igdbId,
      name,
      slug,
      coverImageId,
      releaseYear,
      main,
      extra,
      complete,
      platforms,
      genres,
    ] = row;
    const values: NewGame = {
      igdbId,
      name,
      slug,
      coverImageId,
      releaseYear,
      platforms,
      genres,
      ttbMainSec: main,
      ttbExtraSec: extra,
      ttbCompleteSec: complete,
      ttbSource: (main ?? extra ?? complete) ? "igdb" : null,
      syncedAt: now.toISOString(),
    };
    gameIds.set(key, tx.insert(games).values(values).returning({ id: games.id }).get().id);
  }

  const startedAtOf: Partial<Record<GameKey, string>> = {
    ...Object.fromEntries(firstPlayed),
    stardew: stardewStart,
    deathStranding: deathStrandingStart,
  };
  for (const [key, spec] of Object.entries(LIBRARY) as [GameKey, EntrySpec][]) {
    const dates = finishedDates.get(key);
    const entry: NewLibraryEntry = {
      userId: LEGACY_OWNER_ID,
      gameId: gameIds.get(key)!,
      status: spec.status,
      platformPlayed: spec.platform ?? null,
      startedAt: dates?.startedAt ?? startedAtOf[key] ?? null,
      finishedAt: spec.status === "finished" ? (dates?.finishedAt ?? null) : null,
      rating: spec.rating ?? null,
      notes: spec.notes ?? null,
      priorMinutes: (spec.priorHours ?? 0) * 60,
    };
    tx.insert(libraryEntries).values(entry).run();
  }

  for (const { game, ...session } of sessions) {
    tx.insert(playSessions)
      .values({ ...session, userId: LEGACY_OWNER_ID, gameId: gameIds.get(game)! })
      .run();
  }

  // Conclusões: a história de cada zerado na data em que terminou, mais um 100% (Hades) e um
  // replay em outro ano (Hollow Knight, zerado pela primeira vez uns 13 meses antes).
  const extraCompletions: [GameKey, CompletionType, string][] = [
    ["hades", "full", addDays(finishedDates.get("hades")!.finishedAt, 18)],
    ["hollowKnight", "main", addDays(finishedDates.get("hollowKnight")!.finishedAt, -400)],
  ];
  for (const [key, { finishedAt }] of finishedDates) {
    extraCompletions.push([key, "main", finishedAt]);
  }
  for (const [key, type, completedOn] of extraCompletions) {
    tx.insert(completions)
      .values({ userId: LEGACY_OWNER_ID, gameId: gameIds.get(key)!, type, completedOn })
      .run();
  }

  // Objetivos: Celeste em pós-jogo, o 100% do Hades e as sementes Korok do Zelda.
  const demoObjectives: [GameKey, string, number, number][] = [
    ["celeste", "Lados B de todos os capítulos", 8, 3],
    ["celeste", "Morangos", 175, 142],
    ["celeste", "Corações de cristal", 8, 8],
    ["celeste", "Capítulo 9: Adeus", 1, 0],
    ["hades", "Todas as armas infernais", 6, 6],
    ["hades", "Epílogo", 1, 1],
    ["zeldaTotk", "Sementes Korok", 1000, 412],
    ["zeldaTotk", "Todos os santuários", 152, 152],
  ];
  for (const [index, [key, title, target, progress]] of demoObjectives.entries()) {
    tx.insert(objectives)
      .values({
        userId: LEGACY_OWNER_ID,
        gameId: gameIds.get(key)!,
        title,
        target,
        progress,
        unlockedAt: progress >= target ? now.toISOString() : null,
        sortOrder: index,
      })
      .run();
  }

  // Timer rodando há 47 minutos no Elden Ring.
  const timerStart = new Date(now.getTime() - 47 * 60_000);
  tx.insert(playSessions)
    .values({
      userId: LEGACY_OWNER_ID,
      gameId: gameIds.get("eldenRing")!,
      playedOn: zonedParts(timerStart, TZ).date,
      startedAt: timerStart.toISOString(),
      source: "timer",
    })
    .run();
});
// Valem 24h; depois disso, com credenciais do IGDB, o servidor troca pelas listas de hoje.
for (const key of feedKeys) {
  saveFeedSnapshot(db, key, (demoFeeds as Record<FeedKey, FeedGame[]>)[key], now);
}
for (const page of demoGamePages as IgdbGamePage[]) {
  saveGamePage(db, page, now);
}
db.$client.close();

const totalHours = Math.round(sessions.reduce((sum, s) => sum + (s.minutes ?? 0), 0) / 60);
console.log(
  `Banco de demonstração em ${path}: ${Object.keys(GAMES).length} jogos, ` +
    `${sessions.length} sessões (~${totalHours}h), ofensiva de ${STREAK_DAYS} dias e timer rodando.`,
);
console.log("Entre com o primeiro e-mail de ALLOWED_EMAILS para ficar com os dados.");
