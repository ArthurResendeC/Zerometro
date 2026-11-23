import type { Recap } from "./recap";
import { profileTitle } from "./recap-text";

// Quais slides do recap aparecem. Usado pelos slides (web) e pela imagem de cada slide (servidor).

export const recapSlideIds = [
  "intro",
  "games",
  "genres",
  "discoveries",
  "moments",
  "profile",
  "trophies",
  "summary",
  "empty",
] as const;
export type RecapSlideId = (typeof recapSlideIds)[number];

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
