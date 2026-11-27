import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "./library";
import { pickSuggestion, remainingMinutes, suggestGames, type Suggestion } from "./suggest";

const TODAY = "2026-11-26";
const HOUR = 3600;

// Só os campos que a sugestão lê.
const item = (name: string, fields: Partial<LibraryItem> = {}) =>
  ({
    gameId: name.length,
    name,
    status: "backlog",
    platforms: ["PC"],
    platformPlayed: null,
    emulatedOn: null,
    genres: [],
    themes: [],
    gameModes: ["Single player"],
    perspectives: [],
    timeToBeat: null,
    minutesPlayed: 0,
    progressTarget: "main",
    lastPlayedOn: null,
    lastNote: null,
    ...fields,
  }) as LibraryItem;

const names = (suggestions: Suggestion[]) => suggestions.map((s) => s.item.name);

describe("suggestGames", () => {
  test("só jogando, próximos e pausados; o que está em andamento primeiro", () => {
    const { top } = suggestGames(
      [
        item("Zerado", { status: "finished" }),
        item("Desejo", { status: "wishlist" }),
        item("Próximo"),
        item("Pausado", { status: "paused" }),
        item("Jogando", { status: "playing", lastPlayedOn: "2026-11-25" }),
      ],
      { today: TODAY },
    );
    expect(names(top)).toEqual(["Jogando", "Próximo", "Pausado"]);
    expect(top[0]!.reasons).toEqual(["Jogou ontem: continue no embalo"]);
  });

  test("sem fim entra, acima dos próximos, e ganha um motivo com pouco tempo", () => {
    const games = [item("Próximo"), item("Tarkov", { status: "endless" })];
    expect(names(suggestGames(games, { today: TODAY }).top)).toEqual(["Tarkov", "Próximo"]);
    const { top } = suggestGames(games, { today: TODAY, available: "short" });
    expect(top[0]!.reasons).toEqual(["Sem fim: uma partida cabe em pouco tempo"]);
  });

  test("30 minutos: quem dá para zerar hoje ganha, com o motivo; jogo longo novo perde", () => {
    const { top } = suggestGames(
      [
        item("Longo novo", {
          timeToBeat: { mainSec: 60 * HOUR, extraSec: null, completeSec: null },
        }),
        item("Quase lá", {
          status: "playing",
          lastPlayedOn: "2026-11-01",
          minutesPlayed: 580,
          timeToBeat: { mainSec: 10 * HOUR, extraSec: null, completeSec: null },
        }),
        item("Próximo"),
      ],
      { today: TODAY, available: "short" },
    );
    expect(names(top)).toEqual(["Quase lá", "Próximo", "Longo novo"]);
    expect(top[0]!.reasons).toEqual(["Dá para zerar hoje: faltam ~20min", "Parado há 3 semanas"]);
    expect(top[0]!.remainingMinutes).toBe(20);
  });

  test("coop é obrigatório; os outros climas só pontuam", () => {
    const solo = item("Solo", { genres: ["Puzzle"] });
    const coop = item("Coop", { gameModes: ["Single player", "Co-operative"] });

    expect(names(suggestGames([solo, coop], { today: TODAY, mood: "coop" }).top)).toEqual(["Coop"]);
    const light = suggestGames([coop, solo], { today: TODAY, mood: "leve" }).top;
    expect(names(light)).toEqual(["Solo", "Coop"]);
    expect(light[0]!.reasons).toEqual(["Leve: Quebra-cabeça"]);
  });

  test("história, desafio e curto pelos gêneros, temas e tempo do IGDB", () => {
    const rpg = item("RPG", { genres: ["Role-playing (RPG)"], themes: ["Drama"] });
    const platformer = item("Plataforma", { genres: ["Platform"] });
    const short = item("Curto", {
      timeToBeat: { mainSec: 4 * HOUR, extraSec: null, completeSec: null },
    });
    // Aventura sem tema de história (metroidvania) não é "história".
    const metroidvania = item("Metroidvania", { genres: ["Platform", "Adventure"] });
    const all = [short, platformer, metroidvania, rpg];

    const story = suggestGames(all, { today: TODAY, mood: "historia" }).top;
    expect(story[0]!.item.name).toBe("RPG");
    expect(story.find((s) => s.item.name === "Metroidvania")!.reasons).toEqual([]);
    expect(suggestGames(all, { today: TODAY, mood: "desafio" }).top[0]!.reasons).toEqual([
      "Desafio: Plataforma",
    ]);
    expect(suggestGames(all, { today: TODAY, mood: "curto" }).top[0]!.reasons).toEqual([
      "Curto: ~4h de história",
    ]);
  });

  test("a última nota vira o motivo de continuar; plataforma filtra", () => {
    const { top } = suggestGames(
      [
        item("No PC", {
          status: "playing",
          platformPlayed: "PC",
          lastPlayedOn: TODAY,
          lastNote: { sessionId: 1, note: "Palácio 3", playedOn: TODAY },
        }),
        item("No Switch", { status: "playing", platformPlayed: "Switch" }),
        // Sem plataforma escolhida, valem as do IGDB.
        item("Só no IGDB", { platforms: ["PC", "PS5"] }),
      ],
      { today: TODAY, platform: "PC" },
    );
    expect(names(top)).toEqual(["No PC", "Só no IGDB"]);
    expect(top[0]!.reasons).toEqual(["Você parou em: Palácio 3"]);
  });

  test("jogo emulado conta onde roda: Switch emulado no PC aparece no PC", () => {
    const games = [
      item("Zelda emulado", { platformPlayed: "Switch", emulatedOn: "PC" }),
      item("Mario no Switch", { platformPlayed: "Switch" }),
    ];
    expect(names(suggestGames(games, { today: TODAY, platform: "PC" }).top)).toEqual([
      "Zelda emulado",
    ]);
    expect(names(suggestGames(games, { today: TODAY, platform: "Switch" }).top)).toEqual([
      "Mario no Switch",
    ]);
  });

  test("pool de 8 para o sorteio, top de 3", () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`Jogo ${String(i).padStart(2, "0")}`));
    const { top, pool } = suggestGames(many, { today: TODAY });
    expect(top).toHaveLength(3);
    expect(pool).toHaveLength(8);
  });
});

describe("remainingMinutes", () => {
  test("pelo alvo do progresso (depois de zerar, os extras)", () => {
    const ttb = { mainSec: 10 * HOUR, extraSec: 20 * HOUR, completeSec: null };
    expect(remainingMinutes(item("A", { timeToBeat: ttb, minutesPlayed: 60 }))).toBe(540);
    expect(
      remainingMinutes(
        item("B", { timeToBeat: ttb, minutesPlayed: 700, progressTarget: "extras" }),
      ),
    ).toBe(500);
    expect(remainingMinutes(item("C"))).toBeNull();
  });
});

const scored = (name: string, score: number) =>
  ({ item: item(name), score, reasons: [], remainingMinutes: null }) as Suggestion;

describe("pickSuggestion", () => {
  test("ponderado pela nota; a pior ainda pode sair", () => {
    const pool = [scored("Melhor", 5), scored("Pior", 1)];
    // Pesos 5 e 1: os primeiros 5/6 do intervalo são da melhor.
    expect(pickSuggestion(pool, 0)!.item.name).toBe("Melhor");
    expect(pickSuggestion(pool, 0.8)!.item.name).toBe("Melhor");
    expect(pickSuggestion(pool, 0.9)!.item.name).toBe("Pior");
    expect(pickSuggestion([], 0.5)).toBeNull();
  });
});
