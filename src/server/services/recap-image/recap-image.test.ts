import { describe, expect, test } from "bun:test";
import type { Recap } from "../../../shared/recap";
import { recapSlideIds, recapSlides } from "../../../shared/recap-slides";
import { NotFoundError } from "../../errors";
import { createRecapImageRenderer, renderRecapImage } from ".";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Largura e altura do cabeçalho IHDR do PNG. */
function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Uma capa de 1×1 (PNG transparente). */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function recap(overrides: Partial<Recap> = {}): Recap {
  return {
    period: "week",
    from: "2026-11-09",
    to: "2026-11-15",
    today: "2026-11-19",
    inProgress: false,
    previous: "2026-11-02",
    next: "2026-11-16",
    totalMinutes: 715,
    previousMinutes: 720,
    sessions: 9,
    playedDays: 6,
    daily: [0, 120, 110, 140, 90, 150, 105].map((minutes, i) => ({
      date: `2026-11-${String(9 + i).padStart(2, "0")}`,
      minutes,
    })),
    longestRun: 6,
    gamesPlayed: 3,
    topGames: [
      {
        gameId: 1,
        igdbId: 1,
        name: "Persona 5 Royal",
        coverImageId: "co1",
        minutes: 315,
        sessions: 3,
      },
      {
        gameId: 2,
        igdbId: 2,
        name: "ゼルダの伝説",
        coverImageId: "co2",
        minutes: 215,
        sessions: 4,
      },
      { gameId: 3, igdbId: 3, name: "Celeste", coverImageId: null, minutes: 185, sessions: 2 },
    ],
    topGenres: [{ genre: "Role-playing (RPG)", minutes: 530, games: 2 }],
    newGames: [],
    returningGames: [],
    bestDay: { date: "2026-11-14", minutes: 150 },
    longestSession: null,
    finished: [],
    finishedSummary: { games: 0, replays: 0, full: 0 },
    achievements: { unlocked: 2, games: 1, rarest: null },
    profile: { timedMinutes: 300, dayPart: "night", dayPartShare: 0.7, weekendShare: 0.35 },
    ...overrides,
  };
}

describe("imagem do recap", () => {
  test("stories e paisagem, com capas baixadas uma vez só (cache)", async () => {
    const fetched: string[] = [];
    const renderer = createRecapImageRenderer({
      fetch: async (url) => {
        fetched.push(url);
        // A segunda capa falha: entra o quadro com as iniciais.
        return url.includes("co2")
          ? new Response(null, { status: 500 })
          : new Response(TINY_PNG, { headers: { "content-type": "image/png" } });
      },
    });

    const story = await renderer.render(recap(), "story");
    expect(Array.from(story.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(pngSize(story)).toEqual({ width: 1080, height: 1920 });

    const wide = await renderer.render(recap(), "wide");
    expect(pngSize(wide)).toEqual({ width: 1920, height: 1080 });

    // co1 ficou guardada; co2 falhou e é tentada de novo; sem capa, nada é buscado.
    expect(fetched.filter((u) => u.includes("co1"))).toHaveLength(1);
    expect(fetched.filter((u) => u.includes("co2"))).toHaveLength(2);
    expect(fetched.every((u) => u.startsWith("https://images.igdb.com/"))).toBe(true);
  });

  test("período vazio também vira imagem", async () => {
    const renderer = createRecapImageRenderer({ fetch: async () => new Response(null) });
    const empty = recap({ totalMinutes: 0, topGames: [], topGenres: [], playedDays: 0 });
    expect(pngSize(await renderer.render(empty, "story"))).toEqual({ width: 1080, height: 1920 });
    expect(pngSize(await renderer.render(empty, "wide"))).toEqual({ width: 1920, height: 1080 });
  });

  test("cada slide vira uma imagem de stories, com as capas e o ícone da conquista", async () => {
    const fetched: string[] = [];
    const renderer = createRecapImageRenderer({
      fetch: async (url) => {
        fetched.push(url);
        return new Response(TINY_PNG, { headers: { "content-type": "image/png" } });
      },
    });
    const [p5, zelda, celeste] = recap().topGames;
    const full = recap({
      newGames: [zelda!],
      returningGames: [{ ...celeste!, daysAway: 40 }],
      longestSession: {
        minutes: 140,
        playedOn: "2026-11-12",
        gameId: 1,
        igdbId: 1,
        name: p5!.name,
      },
      finished: [
        {
          gameId: 1,
          igdbId: 1,
          name: p5!.name,
          coverImageId: "co1",
          completedOn: "2026-11-15",
          type: "main",
          completions: 1,
          replays: 0,
          minutesPlayed: 315,
          storyMinutes: null,
          rating: null,
        },
      ],
      achievements: {
        unlocked: 3,
        games: 1,
        rarest: {
          title: "Farewell",
          iconUrl: "https://cdn.steam.example/icon.jpg",
          rarity: 1.4,
          gameId: 3,
          igdbId: 3,
          gameName: "Celeste",
          unlockedOn: "2026-11-14",
        },
      },
    });
    // Com tudo preenchido, todos os slides (menos o vazio) aparecem.
    expect(recapSlides(full)).toEqual(recapSlideIds.filter((id) => id !== "empty"));

    const pngs = await Promise.all(recapSlides(full).map((id) => renderer.renderSlide(full, id)));
    for (const png of pngs) expect(pngSize(png)).toEqual({ width: 1080, height: 1920 });
    const empty = recap({ totalMinutes: 0, topGames: [], topGenres: [], playedDays: 0 });
    expect(pngSize(await renderer.renderSlide(empty, "empty"))).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(fetched).toContain("https://cdn.steam.example/icon.jpg");
  });

  test("slide que não aparece no recap do período não vira imagem", async () => {
    const renderer = createRecapImageRenderer({ fetch: async () => new Response(null) });
    expect(() =>
      renderRecapImage(renderer, recap(), { format: "story", slide: "discoveries" }),
    ).toThrow(NotFoundError);
  });
});
