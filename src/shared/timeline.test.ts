import { describe, expect, test } from "bun:test";
import { timelinePauses, timelineSpans } from "./timeline";

const period = { from: "2026-01-01", to: "2026-12-31" };
const days = (...dates: string[]) => dates.map((date) => ({ date, minutes: 60 }));

describe("timelineSpans", () => {
  test("até 14 dias sem jogar é o mesmo trecho; 15 viram uma pausa", () => {
    // 01 → 16: 14 dias sem jogar no meio. 16 → 01/02: 15 dias.
    const spans = timelineSpans(days("2026-01-01", "2026-01-16", "2026-02-01"), period);
    expect(spans).toEqual([
      {
        from: "2026-01-01",
        to: "2026-01-16",
        minutes: 120,
        playedDays: 2,
        startedBefore: false,
        continuesAfter: false,
      },
      {
        from: "2026-02-01",
        to: "2026-02-01",
        minutes: 60,
        playedDays: 1,
        startedBefore: false,
        continuesAfter: false,
      },
    ]);
    expect(timelinePauses(spans)).toEqual([
      { lastPlayedOn: "2026-01-16", resumedOn: "2026-02-01", days: 15 },
    ]);
  });

  test("o trecho que atravessa a borda encosta nela e conta só os dias de dentro", () => {
    const spans = timelineSpans(days("2025-12-20", "2026-01-03", "2026-12-28", "2027-01-05"), {
      ...period,
      pauseDays: 14,
    });
    expect(spans).toEqual([
      expect.objectContaining({
        from: "2026-01-01",
        to: "2026-01-03",
        playedDays: 1,
        startedBefore: true,
        continuesAfter: false,
      }),
      expect.objectContaining({
        from: "2026-12-28",
        to: "2026-12-31",
        playedDays: 1,
        startedBefore: false,
        continuesAfter: true,
      }),
    ]);
  });

  test("trechos inteiros fora do período somem", () => {
    expect(timelineSpans(days("2025-06-01", "2027-02-01"), period)).toEqual([]);
    expect(timelineSpans([], period)).toEqual([]);
  });
});
