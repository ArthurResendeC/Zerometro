import { describe, expect, test } from "bun:test";
import { type LibraryItem, sortLibraryItems, sortValueOf } from "./library";

// Só os campos que a ordenação lê.
const item = (name: string, fields: Partial<LibraryItem> = {}) =>
  ({
    name,
    lastPlayedOn: null,
    firstPlayedOn: null,
    startedAt: null,
    rating: null,
    ...fields,
  }) as LibraryItem;

const names = (items: LibraryItem[]) => items.map((i) => i.name);

describe("sortValueOf", () => {
  test("comecei a jogar usa a data de início, senão a primeira sessão", () => {
    expect(
      sortValueOf(
        item("A", { startedAt: "2026-01-10", firstPlayedOn: "2025-12-01" }),
        "started_at",
      ),
    ).toBe("2026-01-10");
    expect(sortValueOf(item("B", { firstPlayedOn: "2025-12-01" }), "started_at")).toBe(
      "2025-12-01",
    );
    expect(sortValueOf(item("C"), "started_at")).toBeNull();
  });
});

describe("sortLibraryItems", () => {
  const items = [
    item("Undertale", { lastPlayedOn: "2026-11-01", rating: 9 }),
    item("Hades", { rating: 7 }),
    item("Celeste", { lastPlayedOn: "2026-11-20" }),
    item("Balatro", { lastPlayedOn: "2026-11-01", rating: 10 }),
    item("Animal Well"),
  ];

  test("desc: mais recente primeiro; sem valor no fim, por nome", () => {
    expect(names(sortLibraryItems(items, "last_session"))).toEqual([
      "Celeste",
      "Balatro", // empate na data: por nome
      "Undertale",
      "Animal Well",
      "Hades",
    ]);
  });

  test("asc inverte, mas quem não tem valor continua no fim", () => {
    expect(names(sortLibraryItems(items, "rating", "asc"))).toEqual([
      "Hades",
      "Undertale",
      "Balatro",
      "Animal Well",
      "Celeste",
    ]);
  });

  test("nota compara números, não texto (10 > 9)", () => {
    expect(names(sortLibraryItems(items, "rating")).slice(0, 2)).toEqual(["Balatro", "Undertale"]);
  });

  test("não mexe na lista original", () => {
    const before = names(items);
    sortLibraryItems(items, "rating");
    expect(names(items)).toEqual(before);
  });

  test("nome sem diferenciar acento e com números em ordem natural", () => {
    const tied = [item("Zelda 10"), item("Ábzu"), item("Zelda 2"), item("abc")];
    expect(names(sortLibraryItems(tied, "rating"))).toEqual(["abc", "Ábzu", "Zelda 2", "Zelda 10"]);
  });
});
