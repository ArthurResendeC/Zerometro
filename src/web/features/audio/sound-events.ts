import type { StreakChange } from "@shared/sessions";
import type { SoundName } from "./sounds";

// Regras de quando cada som toca. Puras (sem áudio), para testar com `bun test`.

/** Do mais para o menos importante: quando uma ação dispara vários sons, só o primeiro toca. */
export const soundPriority: readonly SoundName[] = [
  "goal-reached",
  "game-finished",
  "streak-milestone",
  "session-stop",
  "session-start",
  "roulette-win",
  "roulette-tick",
];

/** Escolhe o som mais importante entre os eventos de uma ação (valores falsy são ignorados). */
export function pickSound(
  events: readonly (SoundName | false | null | undefined)[],
): SoundName | null {
  return soundPriority.find((sound) => events.includes(sound)) ?? null;
}

export const streakMilestones = [7, 30, 100, 365] as const;

/** A ofensiva passou de abaixo para igual ou acima de algum marco (ex.: 6 → 7 sim, 7 → 8 não). */
export function reachedStreakMilestone({ before, current }: StreakChange): boolean {
  return streakMilestones.some((milestone) => before < milestone && current >= milestone);
}
