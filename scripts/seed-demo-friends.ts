// Amigos do demo, para o ranking do grupo (/grupo) e os perfis (/amigo/:handle). Cada um tem o
// próprio ritmo: a Bia joga todo dia e zerou dois jogos há pouco, o Caio faz sessões longas e
// está jogando agora, a Duda joga pouco e com folgas. Todos entram com a senha DEMO_PASSWORD.
import { eq } from "drizzle-orm";
import type { Avatar } from "../src/shared/auth";
import { addDays, zonedToInstant } from "../src/shared/dates";
import type { CompletionType, GameStatus } from "../src/shared/domain";
import type { Db } from "../src/server/db/client";
import {
  achievementUnlocks,
  achievements,
  completions,
  games,
  libraryEntries,
  playSessions,
  user,
  userAchievementSets,
} from "../src/server/db/schema";
import { GAMES, type GameKey } from "./demo-library";

export const DEMO_PASSWORD = "demo-senha";

interface FriendGame {
  key: GameKey;
  status: GameStatus;
  /** Chance relativa de ser o jogo do dia na janela (0 = não jogou nela). */
  weight?: number;
  /** Zerou há tantos dias (antes disso, o jogo sai do sorteio). */
  finishedAgo?: number;
  /** Também fez o 100%, tantos dias depois de zerar. */
  fullAfter?: number;
  priorHours?: number;
  rating?: number;
}

interface Friend {
  id: string;
  name: string;
  handle: string;
  avatar: Avatar;
  /** Dias para trás com sessões. */
  window: number;
  /** Chance de jogar num dia fora da ofensiva. */
  playChance: number;
  minutes: [number, number];
  /** Dias seguidos até ontem (com o mínimo diário de 30min). */
  streak: number;
  games: FriendGame[];
  /** Timer rodando agora, há tantos minutos. */
  playingNow?: { key: GameKey; minutesAgo: number };
  /** Desbloqueia as conquistas do Celeste: as comuns há tempo, as raras no último mês. */
  celesteAchievements?: boolean;
}

const FRIENDS: Friend[] = [
  {
    id: "demo-bia",
    name: "Bia",
    handle: "bia",
    avatar: "cat",
    window: 45,
    playChance: 0.8,
    minutes: [60, 200],
    streak: 21,
    games: [
      { key: "clairObscur", status: "finished", weight: 4, finishedAgo: 5, rating: 9.5 },
      { key: "sekiro", status: "finished", weight: 3, finishedAgo: 11, rating: 9 },
      { key: "hades2", status: "playing", weight: 2 },
      {
        key: "celeste",
        status: "finished",
        finishedAgo: 320,
        fullAfter: 20,
        priorHours: 38,
        rating: 10,
      },
      { key: "gta6", status: "wishlist" },
    ],
    celesteAchievements: true,
  },
  {
    id: "demo-caio",
    name: "Caio",
    handle: "caio",
    avatar: "skull",
    window: 60,
    playChance: 0.45,
    minutes: [90, 300],
    streak: 3,
    games: [
      { key: "rdr2", status: "playing", weight: 3, priorHours: 12 },
      { key: "silksong", status: "playing", weight: 2 },
      {
        key: "witcher3",
        status: "finished",
        weight: 2,
        finishedAgo: 24,
        priorHours: 70,
        rating: 8.5,
      },
      { key: "eldenRing", status: "backlog" },
    ],
    playingNow: { key: "silksong", minutesAgo: 80 },
  },
  {
    id: "demo-duda",
    name: "Duda",
    handle: "duda",
    avatar: "potion",
    window: 30,
    playChance: 0.5,
    minutes: [30, 100],
    streak: 0,
    games: [
      { key: "stardew", status: "playing", weight: 3, priorHours: 45 },
      { key: "persona5", status: "playing", weight: 1 },
      { key: "hollowKnight", status: "finished", finishedAgo: 410, priorHours: 34, rating: 9 },
      { key: "outerWilds", status: "backlog" },
    ],
  },
];

const roundTo5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5);

export function seedDemoFriends(db: Db, opts: { today: string; now: Date; tz: string }) {
  const { today, now, tz } = opts;
  // Sorteio com semente própria: os dados do dono não mudam com os amigos.
  let state = 0x5eed_f00d;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const gameId = (key: GameKey) =>
    db.select({ id: games.id }).from(games).where(eq(games.igdbId, GAMES[key][0])).get()!.id;
  const passwordHash = Bun.password.hashSync(DEMO_PASSWORD);

  for (const friend of FRIENDS) {
    db.insert(user)
      .values({
        id: friend.id,
        name: friend.name,
        email: `${friend.id}@zerometro.invalid`,
        handle: friend.handle,
        avatar: friend.avatar,
        passwordHash,
        createdAt: new Date(now.getTime() - 60 * 86_400_000),
      })
      .run();

    // Sessões: um jogo por dia, sorteado entre os que ainda não tinha zerado nesse dia.
    const firstPlayed = new Map<GameKey, string>();
    for (let ago = friend.window; ago >= 1; ago--) {
      const inStreak = ago <= friend.streak;
      if (ago === friend.streak + 1 || (!inStreak && rand() > friend.playChance)) continue;
      const pool = friend.games.filter(
        (g) => (g.weight ?? 0) > 0 && (g.finishedAgo === undefined || g.finishedAgo <= ago),
      );
      let r = rand() * pool.reduce((sum, g) => sum + g.weight!, 0);
      const game = pool.find((g) => (r -= g.weight!) < 0) ?? pool[0];
      if (!game) continue;
      const day = addDays(today, -ago);
      if (!firstPlayed.has(game.key)) firstPlayed.set(game.key, day);
      const minutes = roundTo5(Math.max(between(...friend.minutes), inStreak ? 30 : 0));
      const start = zonedToInstant(
        day,
        `${between(18, 21)}:${String(between(0, 11) * 5).padStart(2, "0")}`,
        tz,
      );
      db.insert(playSessions)
        .values({
          userId: friend.id,
          gameId: gameId(game.key),
          playedOn: day,
          minutes,
          startedAt: start.toISOString(),
          endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
          source: "timer",
        })
        .run();
    }

    for (const game of friend.games) {
      const finishedAt = game.finishedAgo === undefined ? null : addDays(today, -game.finishedAgo);
      const startedAt =
        firstPlayed.get(game.key) ??
        (finishedAt ? addDays(finishedAt, -40) : game.status === "playing" ? today : null);
      db.insert(libraryEntries)
        .values({
          userId: friend.id,
          gameId: gameId(game.key),
          status: game.status,
          startedAt,
          finishedAt,
          rating: game.rating ?? null,
          priorMinutes: (game.priorHours ?? 0) * 60,
        })
        .run();
      const done: [CompletionType, string][] = finishedAt ? [["main", finishedAt]] : [];
      if (finishedAt && game.fullAfter) done.push(["full", addDays(finishedAt, game.fullAfter)]);
      for (const [type, completedOn] of done) {
        db.insert(completions)
          .values({ userId: friend.id, gameId: gameId(game.key), type, completedOn })
          .run();
      }
    }

    if (friend.playingNow) {
      const start = new Date(now.getTime() - friend.playingNow.minutesAgo * 60_000);
      db.insert(playSessions)
        .values({
          userId: friend.id,
          gameId: gameId(friend.playingNow.key),
          playedOn: today,
          startedAt: start.toISOString(),
          source: "timer",
        })
        .run();
    }

    if (friend.celesteAchievements) {
      // A mesma lista que o dono segue (salva antes pelo seed).
      const celeste = gameId("celeste");
      const set = db
        .select({ setId: userAchievementSets.setId })
        .from(userAchievementSets)
        .where(eq(userAchievementSets.gameId, celeste))
        .get();
      if (set) {
        db.insert(userAchievementSets)
          .values({ userId: friend.id, gameId: celeste, setId: set.setId })
          .run();
        const list = db
          .select({ id: achievements.id, rarity: achievements.rarity })
          .from(achievements)
          .where(eq(achievements.setId, set.setId))
          .all();
        for (const a of list) {
          const daysAgo = (a.rarity ?? 0) < 10 ? between(1, 25) : between(300, 330);
          db.insert(achievementUnlocks)
            .values({
              userId: friend.id,
              achievementId: a.id,
              unlockedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
            })
            .run();
        }
      }
    }
  }
  return FRIENDS.map((f) => `@${f.handle}`);
}
