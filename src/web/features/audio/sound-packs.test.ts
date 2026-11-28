import { describe, expect, test } from "bun:test";
import { sfxr } from "jsfxr";
import { soundPackIds, themeSoundPack } from "@shared/items";
import { themeIds } from "@shared/themes";
import { soundNames, soundPackLoaders } from "./sounds";

// Todo pacote de som tem todos os sons, e cada um sintetiza algo audível e curto.

describe.each([...soundPackIds])("pacote %s", (id) => {
  test("tem exatamente os sons do app", async () => {
    const pack = await soundPackLoaders[id]();
    expect(Object.keys(pack).toSorted()).toEqual([...soundNames].toSorted());
  });

  test.each([...soundNames])("%s sintetiza um som curto (até 3s)", async (name) => {
    const pack = await soundPackLoaders[id]();
    const samples = sfxr.toBuffer(pack[name]);
    const seconds = samples.length / Number(pack[name].sample_rate);
    expect(seconds).toBeGreaterThan(0.002); // o tique da roleta tem ~8ms
    expect(seconds).toBeLessThan(3);
  });
});

test("todo tema tem um pacote de som que existe", () => {
  for (const theme of themeIds) expect(soundPackIds).toContain(themeSoundPack[theme]);
});
