import { beforeEach, describe, expect, test } from "bun:test";

// O Bun não tem localStorage: um em memória, criado antes de a store nascer (sem storage, o
// zustand desliga o persist).
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

const { AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, parseAudioSettings, useAudioSettings } =
  await import("./audio-settings-store");

describe("parseAudioSettings", () => {
  test("valores válidos passam", () => {
    expect(parseAudioSettings({ enabled: true, volume: 0.8 })).toEqual({
      enabled: true,
      volume: 0.8,
    });
    expect(parseAudioSettings({ enabled: false, volume: 0 })).toEqual({
      enabled: false,
      volume: 0,
    });
  });

  test("nada salvo → padrão (som desligado, volume 0.5)", () => {
    expect(parseAudioSettings(undefined)).toEqual({ enabled: false, volume: 0.5 });
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings({})).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  test("lixo no lugar do objeto → padrão", () => {
    expect(parseAudioSettings("abc")).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings(42)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings([true, 1])).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  test("campo inválido cai no padrão sem perder o outro", () => {
    expect(parseAudioSettings({ enabled: "sim", volume: 0.2 })).toEqual({
      enabled: false,
      volume: 0.2,
    });
    expect(parseAudioSettings({ enabled: true, volume: 7 })).toEqual({
      enabled: true,
      volume: 0.5,
    });
    expect(parseAudioSettings({ enabled: true, volume: -0.1 })).toEqual({
      enabled: true,
      volume: 0.5,
    });
    expect(parseAudioSettings({ enabled: true, volume: "1" })).toEqual({
      enabled: true,
      volume: 0.5,
    });
  });
});

/** Grava no storage como o persist do zustand faz. */
function saved(state: unknown) {
  memory.set(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({ state, version: 1 }));
}

describe("useAudioSettings", () => {
  beforeEach(() => {
    memory.clear();
    useAudioSettings.setState({ ...DEFAULT_AUDIO_SETTINGS });
  });

  test("começa desligado com volume 0.5", () => {
    expect(useAudioSettings.getState()).toMatchObject({ enabled: false, volume: 0.5 });
  });

  test("salva no storage", () => {
    useAudioSettings.getState().setEnabled(true);
    useAudioSettings.getState().setVolume(0.3);
    expect(JSON.parse(memory.get(AUDIO_SETTINGS_STORAGE_KEY) ?? "{}").state).toEqual({
      enabled: true,
      volume: 0.3,
    });
  });

  test("recarrega o que estava salvo", async () => {
    saved({ enabled: true, volume: 0.3 });
    await useAudioSettings.persist.rehydrate();
    expect(useAudioSettings.getState()).toMatchObject({ enabled: true, volume: 0.3 });
  });

  test("dado inválido no storage cai no padrão", async () => {
    saved({ enabled: "yes", volume: 99 });
    await useAudioSettings.persist.rehydrate();
    expect(useAudioSettings.getState()).toMatchObject({ enabled: false, volume: 0.5 });

    memory.set(AUDIO_SETTINGS_STORAGE_KEY, "{corrompido");
    await useAudioSettings.persist.rehydrate();
    expect(useAudioSettings.getState()).toMatchObject({ enabled: false, volume: 0.5 });
  });

  test("setVolume limita entre 0 e 1", () => {
    useAudioSettings.getState().setVolume(1.5);
    expect(useAudioSettings.getState().volume).toBe(1);
    useAudioSettings.getState().setVolume(-1);
    expect(useAudioSettings.getState().volume).toBe(0);
    useAudioSettings.getState().setVolume(Number.NaN);
    expect(useAudioSettings.getState().volume).toBe(0.5);
  });
});
