import type { DayPart, Recap, RecapPeriod, RecapProfile } from "@shared/recap";

// Textos e escolha dos slides do recap. Puros (sem React), para testar com `bun test`.

export type RecapSlideId =
  | "intro"
  | "games"
  | "genres"
  | "discoveries"
  | "moments"
  | "profile"
  | "trophies"
  | "summary"
  | "empty";

/** Fatia do fim de semana a partir da qual o perfil vira "de fim de semana". */
const WEEKEND_PROFILE_SHARE = 0.6;

/** Os slides que têm o que mostrar, na ordem. Sem nada no período, só o slide vazio. */
export function recapSlides(recap: Recap): RecapSlideId[] {
  const hasTrophies = recap.finished.length > 0 || recap.achievements.unlocked > 0;
  if (recap.totalMinutes === 0 && !hasTrophies) return ["empty"];

  const slides: RecapSlideId[] = ["intro"];
  if (recap.topGames.length > 0) slides.push("games");
  if (recap.topGenres.length > 0) slides.push("genres");
  if (recap.newGames.length > 0 || recap.returningGames.length > 0) slides.push("discoveries");
  if (recap.bestDay) slides.push("moments");
  if (profileTitle(recap.profile)) slides.push("profile");
  if (hasTrophies) slides.push("trophies");
  slides.push("summary");
  return slides;
}

const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const weekdayLong = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });

const utc = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/** "Sua semana" / "Seu novembro". */
export function recapKicker(period: RecapPeriod, from: string): string {
  return period === "week" ? "Sua semana" : `Seu ${monthName.format(utc(from))}`;
}

/** "9 a 15 de nov." (mesmo mês), "28 de dez. a 3 de jan." ou "novembro de 2026". */
export function periodLabel(period: RecapPeriod, from: string, to: string): string {
  if (period === "month") return `${monthName.format(utc(from))} de ${from.slice(0, 4)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${Number(from.slice(8))} a ${dayMonth.format(utc(to))}`;
  }
  return `${dayMonth.format(utc(from))} a ${dayMonth.format(utc(to))}`;
}

/** "sexta-feira, 13 de nov." */
export function dayLabel(isoDate: string): string {
  return `${weekdayLong.format(utc(isoDate))}, ${dayMonth.format(utc(isoDate))}`;
}

/** Comparação com o período anterior: seta e texto. */
export function comparison(
  period: RecapPeriod,
  total: number,
  previous: number,
): { trend: "up" | "down" | "same"; text: string } {
  const before = period === "week" ? "a semana anterior" : "o mês anterior";
  const same = period === "week" ? "Igual à semana anterior" : "Igual ao mês anterior";
  if (previous === 0) {
    if (total === 0) return { trend: "same", text: same };
    return {
      trend: "up",
      text: period === "week" ? "Nada jogado na semana anterior" : "Nada jogado no mês anterior",
    };
  }
  const diff = Math.round(((total - previous) / previous) * 100);
  if (diff === 0) return { trend: "same", text: same };
  return {
    trend: diff > 0 ? "up" : "down",
    text: `${Math.abs(diff)}% ${diff > 0 ? "a mais" : "a menos"} que ${before}`,
  };
}

const dayPartTitles: Record<DayPart, string> = {
  dawn: "Coruja da madrugada",
  morning: "Jogador matinal",
  afternoon: "Jogador da tarde",
  night: "Jogador noturno",
};

const dayPartNames: Record<DayPart, string> = {
  dawn: "de madrugada",
  morning: "de manhã",
  afternoon: "à tarde",
  night: "à noite",
};

/** O título do perfil, ou null quando não há o que dizer (aí o slide não aparece). */
export function profileTitle(profile: RecapProfile): string | null {
  if (profile.dayPart) return dayPartTitles[profile.dayPart];
  if ((profile.weekendShare ?? 0) >= WEEKEND_PROFILE_SHARE) return "Guerreiro de fim de semana";
  return null;
}

/** As frases que explicam o perfil. */
export function profileFacts(profile: RecapProfile): string[] {
  const facts: string[] = [];
  if (profile.dayPart && profile.dayPartShare !== null) {
    facts.push(
      `${percent(profile.dayPartShare)} do tempo cronometrado foi ${dayPartNames[profile.dayPart]}`,
    );
  }
  if (profile.weekendShare !== null) {
    facts.push(`${percent(profile.weekendShare)} do tempo no fim de semana`);
  }
  return facts;
}

export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** "1 jogo" / "3 jogos". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
