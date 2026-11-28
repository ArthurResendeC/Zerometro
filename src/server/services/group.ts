// O grupo: o ranking entre os perfis da instância e o que cada um deixa os amigos verem. Quem
// desligou "Aparecer no grupo" ou está suspenso fica de fora. As notas das sessões e o "onde
// parei" nunca saem daqui; as seções do /amigo (e a nota dos jogos), cada um escolhe.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, min, sql } from "drizzle-orm";
import { type Avatar, avatars, DEFAULT_AVATAR } from "../../shared/auth";
import { isSectionShared, sharedSections } from "../../shared/group-sections";
import { startOfWeek } from "../../shared/dates";
import type {
  GroupGameEntry,
  GroupGameRef,
  GroupLeaderboard,
  GroupMember,
  GroupMemberGame,
  GroupMemberGamerProfile,
  GroupMemberProfile,
  GroupMemberStats,
  GroupMemberStatsView,
  GroupPeriod,
} from "../../shared/group";
import type { LibraryItem } from "../../shared/library";
import { type ProfileRow, type ProfileSection, profileSections } from "../../shared/profile";
import type { StatsPeriod } from "../../shared/stats";
import type { DbOrTx } from "../db/client";
import {
  achievementUnlocks,
  achievements,
  completions,
  games,
  libraryEntries,
  playSessions,
  user,
  userAchievementSets,
} from "../db/schema";
import { NotFoundError } from "../errors";
import type { ServiceContext, UserScope } from "./context";
import { getLibraryItem, listLibrary } from "./library";
import { getProfile } from "./profile";
import { getSettings } from "./settings";
import { getPurchaseStats } from "./purchases";
import {
  activeYears,
  currentStreak,
  getHeatmap,
  getPeriodBreakdown,
  getRecords,
  getRhythm,
  minutesByDay,
} from "./stats";
import { getTimeline } from "./timeline";
import { getActiveSession } from "./timer";

const PROFILE_GAMES = 12;

const isAvatar = (value: string | null): value is Avatar =>
  (avatars as readonly string[]).includes(value ?? "");

/** Perfis ativos que aparecem no grupo (com @apelido), na ordem em que entraram. */
function visibleMembers(db: DbOrTx, viewerId: string): GroupMember[] {
  return db
    .select({ id: user.id, name: user.name, handle: user.handle, avatar: user.avatar })
    .from(user)
    .where(and(isNull(user.disabledAt), isNotNull(user.handle)))
    .orderBy(asc(user.createdAt))
    .all()
    .filter((row) => getSettings({ db, userId: row.id }).shareWithGroup)
    .map((row) => ({
      userId: row.id,
      name: row.name,
      handle: row.handle!,
      avatar: isAvatar(row.avatar) ? row.avatar : DEFAULT_AVATAR,
      isMe: row.id === viewerId,
    }));
}

/** Dias do período no fuso do usuário (o "sempre" começa no ano 0). */
export function groupPeriodRange(period: GroupPeriod, today: string) {
  const from =
    period === "week"
      ? startOfWeek(today)
      : period === "month"
        ? `${today.slice(0, 7)}-01`
        : period === "year"
          ? `${today.slice(0, 4)}-01-01`
          : "0000-01-01";
  return { from, to: today };
}

const gameRef = (row: { igdbId: number; name: string; coverImageId: string | null }) => ({
  igdbId: row.igdbId,
  name: row.name,
  coverImageId: row.coverImageId,
});

const playingNow = (scope: UserScope): GroupGameRef | null => {
  const active = getActiveSession(scope);
  return active
    ? { igdbId: active.igdbId, name: active.gameName, coverImageId: active.coverImageId }
    : null;
};

/** Jogos zerados pela primeira vez (e os que chegaram aos 100%) entre `from` e `to`. */
function completionCounts({ db, userId }: UserScope, from: string, to: string) {
  const firstOf = (types?: "full") =>
    db
      .select({ gameId: completions.gameId, first: min(completions.completedOn) })
      .from(completions)
      .where(and(eq(completions.userId, userId), types ? eq(completions.type, types) : undefined))
      .groupBy(completions.gameId)
      .all()
      .filter((row) => row.first !== null && row.first >= from && row.first <= to).length;
  return { finished: firstOf(), fullCompletions: firstOf("full") };
}

/**
 * Conquistas desbloqueadas no período e a mais rara delas. O dia é o do horário em UTC (as
 * conquistas guardam só o instante): perto da meia-noite, pode cair no dia vizinho.
 */
function achievementStats({ db, userId }: UserScope, from: string, to: string) {
  const day = sql<string>`substr(${achievementUnlocks.unlockedAt}, 1, 10)`;
  const inPeriod = and(
    eq(achievementUnlocks.userId, userId),
    isNull(achievements.removedAt),
    gte(day, from),
    lte(day, to),
  );
  const count =
    db
      .select({ n: sql<number>`count(*)` })
      .from(achievementUnlocks)
      .innerJoin(achievements, eq(achievements.id, achievementUnlocks.achievementId))
      .where(inPeriod)
      .get()?.n ?? 0;
  // O jogo da conquista: um da biblioteca da pessoa que segue a lista dela.
  const rarest = db
    .select({
      title: achievements.title,
      rarity: achievements.rarity,
      igdbId: games.igdbId,
      name: games.name,
      coverImageId: games.coverImageId,
    })
    .from(achievementUnlocks)
    .innerJoin(achievements, eq(achievements.id, achievementUnlocks.achievementId))
    .innerJoin(
      userAchievementSets,
      and(
        eq(userAchievementSets.setId, achievements.setId),
        eq(userAchievementSets.userId, userId),
      ),
    )
    .innerJoin(games, eq(games.id, userAchievementSets.gameId))
    .where(and(inPeriod, isNotNull(achievements.rarity)))
    .orderBy(asc(achievements.rarity))
    .limit(1)
    .get();
  return {
    achievements: count,
    rarestAchievement: rarest
      ? { ...gameRef(rarest), title: rarest.title, rarity: rarest.rarity! }
      : null,
  };
}

function topGameIn({ db, userId }: UserScope, from: string, to: string) {
  const minutes = sql<number>`sum(${playSessions.minutes})`;
  const row = db
    .select({
      igdbId: games.igdbId,
      name: games.name,
      coverImageId: games.coverImageId,
      minutes,
    })
    .from(playSessions)
    .innerJoin(games, eq(games.id, playSessions.gameId))
    .where(
      and(
        eq(playSessions.userId, userId),
        gte(playSessions.playedOn, from),
        lte(playSessions.playedOn, to),
        isNotNull(playSessions.minutes),
      ),
    )
    .groupBy(games.id)
    .orderBy(desc(minutes))
    .limit(1)
    .get();
  return row ? { ...gameRef(row), minutes: row.minutes } : null;
}

const libraryMinutes = (items: LibraryItem[]) =>
  items.reduce((sum, item) => sum + item.minutesPlayed, 0);

function memberStats(
  ctx: ServiceContext,
  member: GroupMember,
  period: GroupPeriod,
  from: string,
  to: string,
): GroupMemberStats {
  const scope: UserScope = { db: ctx.db, userId: member.userId };
  const daily = minutesByDay(scope, from, to);
  const sessionMinutes = [...daily.values()].reduce((sum, m) => sum + m, 0);
  return {
    ...member,
    minutes: period === "all" ? libraryMinutes(listLibrary(scope)) : sessionMinutes,
    playedDays: daily.size,
    ...completionCounts(scope, from, to),
    ...achievementStats(scope, from, to),
    streak: currentStreak(scope, ctx.today),
    topGame: topGameIn(scope, from, to),
    playingNow: playingNow(scope),
  };
}

/** O ranking do grupo no período: a tela ordena pela métrica escolhida. */
export function getLeaderboard(ctx: ServiceContext, period: GroupPeriod): GroupLeaderboard {
  const { from, to } = groupPeriodRange(period, ctx.today);
  const members = visibleMembers(ctx.db, ctx.userId);
  return {
    period,
    from,
    to,
    members: members.map((member) => memberStats(ctx, member, period, from, to)),
    meHidden: !members.some((member) => member.isMe),
  };
}

const memberGame = (item: LibraryItem): GroupMemberGame => ({
  ...gameRef(item),
  status: item.status,
  minutesPlayed: item.minutesPlayed,
  completion: item.completion
    ? { best: item.completion.best, lastCompletedOn: item.completion.lastCompletedOn }
    : null,
  rating: item.rating,
});

/** Alguém do grupo pelo @apelido, com o que deixa os amigos verem. */
function findMember(ctx: ServiceContext, handle: string) {
  const member = visibleMembers(ctx.db, ctx.userId).find((m) => m.handle === handle);
  if (!member) throw new NotFoundError(`@${handle} não está no grupo`);
  const scope: UserScope = { db: ctx.db, userId: member.userId };
  const settings = getSettings(scope);
  const shared = new Set(sharedSections(settings.groupSections));
  return { member, scope, settings, shared };
}

/** Só o que estiver compartilhado é calculado; o resto vem null. */
const when = <T>(shared: boolean, value: () => T): T | null => (shared ? value() : null);

const withoutRating = (game: GroupMemberGame): GroupMemberGame => ({ ...game, rating: null });

/** O perfil público de alguém do grupo, pelo @apelido (a aba Resumo). */
export function getMemberProfile(ctx: ServiceContext, handle: string): GroupMemberProfile {
  const { member, scope, shared } = findMember(ctx, handle);
  const library = listLibrary(scope);
  const showRating = shared.has("ratings");
  const game = (item: LibraryItem) =>
    showRating ? memberGame(item) : withoutRating(memberGame(item));

  return {
    member,
    playingNow: playingNow(scope),
    sections: [...shared],
    totals: when(shared.has("totals"), () => {
      const { from, to } = groupPeriodRange("all", ctx.today);
      return {
        minutes: libraryMinutes(library),
        ...completionCounts(scope, from, to),
        achievements: achievementStats(scope, from, to).achievements,
        streak: currentStreak(scope, ctx.today),
        games: library.length,
      };
    }),
    playing: when(shared.has("playing"), () => {
      const lastPlayed = new Map(
        ctx.db
          .select({
            gameId: playSessions.gameId,
            last: sql<string>`max(${playSessions.playedOn})`,
          })
          .from(playSessions)
          .where(eq(playSessions.userId, member.userId))
          .groupBy(playSessions.gameId)
          .all()
          .map((row) => [row.gameId, row.last]),
      );
      return library
        .filter((item) => item.status === "playing")
        .toSorted((a, b) =>
          (lastPlayed.get(b.gameId) ?? "").localeCompare(lastPlayed.get(a.gameId) ?? ""),
        )
        .slice(0, PROFILE_GAMES)
        .map(game);
    }),
    recentlyFinished: when(shared.has("finished"), () => {
      const byGameId = new Map(library.map((item) => [item.gameId, item]));
      return (
        ctx.db
          .select({
            gameId: completions.gameId,
            type: completions.type,
            completedOn: completions.completedOn,
          })
          .from(completions)
          .where(eq(completions.userId, member.userId))
          .orderBy(desc(completions.completedOn), desc(completions.id))
          .all()
          // Um jogo por vez na lista, com a conclusão mais recente (o 100% depois da história).
          .filter((row, i, rows) => rows.findIndex((r) => r.gameId === row.gameId) === i)
          .slice(0, PROFILE_GAMES)
          .flatMap((row) => {
            const item = byGameId.get(row.gameId);
            return item ? [{ ...game(item), completedOn: row.completedOn, type: row.type }] : [];
          })
      );
    }),
    ratings: when(showRating, () =>
      library
        .filter((item) => item.rating !== null)
        .toSorted((a, b) => b.rating! - a.rating! || a.name.localeCompare(b.name))
        .map(memberGame),
    ),
  };
}

/** A aba Estatísticas de alguém do grupo, no ano (ou nos últimos 12 meses). */
export function getMemberStats(
  ctx: ServiceContext,
  handle: string,
  { year }: StatsPeriod,
): GroupMemberStatsView {
  const { scope, settings, shared } = findMember(ctx, handle);
  const period = { today: ctx.today, year };
  return {
    year: year ?? null,
    years: activeYears(scope, Number(ctx.today.slice(0, 4))),
    heatmap: when(shared.has("heatmap"), () =>
      getHeatmap(scope, { ...period, streakMinMinutes: settings.streakMinMinutes }),
    ),
    breakdown: when(shared.has("breakdown"), () => getPeriodBreakdown(scope, period)),
    timeline: when(shared.has("timeline"), () => getTimeline(scope, period)),
    rhythm: when(shared.has("rhythm"), () =>
      getRhythm(scope, { ...period, timeZone: ctx.timeZone }),
    ),
    records: when(shared.has("records"), () => {
      const records = getRecords(scope, period);
      // A lista de zerados traz a nota: com as notas escondidas, sai daqui também.
      if (!shared.has("ratings")) for (const game of records.finished) game.rating = null;
      return records;
    }),
    purchases: when(shared.has("purchases"), () => getPurchaseStats(scope, period)),
  };
}

/** A aba Perfil de gamer de alguém do grupo: só os rankings compartilhados. */
export function getMemberGamerProfile(
  ctx: ServiceContext,
  handle: string,
): GroupMemberGamerProfile {
  const { scope, shared } = findMember(ctx, handle);
  const profile = getProfile(scope);
  const ratingsShared = shared.has("ratings");
  // Sem as notas, a média por linha também revelaria o gosto: sai junto.
  const rows = (list: ProfileRow[]) =>
    ratingsShared ? list : list.map((row) => ({ ...row, avgRating: null, ratedGames: 0 }));
  const rankings = Object.fromEntries(
    profileSections.map((section) => [
      section,
      when(shared.has(section), () => rows(profile[section])),
    ]),
  ) as Record<ProfileSection, ProfileRow[] | null>;
  return {
    gamesCounted: profile.gamesCounted,
    totalMinutes: profile.totalMinutes,
    ...rankings,
    criteria: when(shared.has("criteria"), () => profile.criteria),
    ratingsShared,
  };
}

/** Quem do grupo tem o jogo (pelo id do IGDB), os que mais jogaram primeiro. */
export function getGameInGroup(ctx: ServiceContext, igdbId: number): GroupGameEntry[] {
  const game = ctx.db.select({ id: games.id }).from(games).where(eq(games.igdbId, igdbId)).get();
  if (!game) return [];
  const members = visibleMembers(ctx.db, ctx.userId);
  const owners = new Set(
    ctx.db
      .select({ userId: libraryEntries.userId })
      .from(libraryEntries)
      .where(
        and(
          eq(libraryEntries.gameId, game.id),
          inArray(
            libraryEntries.userId,
            members.map((m) => m.userId),
          ),
        ),
      )
      .all()
      .map((row) => row.userId),
  );
  return members
    .filter((member) => owners.has(member.userId))
    .map((member) => {
      const scope: UserScope = { db: ctx.db, userId: member.userId };
      const item = getLibraryItem(scope, game.id);
      const { completion, ...rest } = memberGame(item);
      const { groupSections } = getSettings(scope);
      return {
        member,
        status: rest.status,
        minutesPlayed: rest.minutesPlayed,
        completion,
        rating: isSectionShared(groupSections, "ratings") ? rest.rating : null,
        achievements: item.achievements,
      };
    })
    .toSorted((a, b) => b.minutesPlayed - a.minutesPlayed);
}
