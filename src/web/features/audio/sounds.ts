import { type SfxrDefinition, sfxr } from "jsfxr";
import { DEFAULT_SOUND_PACK, type SoundPackId } from "@shared/items";
import cartucho from "./packs/cartucho.json";

// Efeitos sonoros sintetizados no navegador pelo jsfxr a partir de um pacote JSON (nada de .wav no
// repo). Cada tema tem o seu pacote (packs/<id>.json); o do tema base vai no bundle e os outros
// chegam sob demanda. Cada som é gerado uma vez por pacote, no primeiro play, e fica em cache.

export const soundNames = [
  "session-start",
  "session-stop",
  "game-finished",
  "streak-milestone",
  "goal-reached",
  "roulette-tick",
  "roulette-win",
] as const;
export type SoundName = (typeof soundNames)[number];

/** Um pacote: a definição jsfxr de cada som. */
export type SoundPack = Record<SoundName, SfxrDefinition>;

/** Nome de cada som na tela de ajustes. */
export const soundLabels: Record<SoundName, string> = {
  "session-start": "Começou a jogar",
  "session-stop": "Parou de jogar",
  "game-finished": "Jogo zerado",
  "streak-milestone": "Marco da ofensiva",
  "goal-reached": "Meta do ano batida",
  "roulette-tick": "Roleta girando",
  "roulette-win": "Roleta escolheu",
};

/** Carregadores dos pacotes (o do tema base já está no bundle). */
export const soundPackLoaders: Record<SoundPackId, () => Promise<SoundPack>> = {
  cartucho: () => Promise.resolve(cartucho),
  minimal: () => import("./packs/minimal.json").then((m) => m.default),
  "ladrao-fantasma": () => import("./packs/ladrao-fantasma.json").then((m) => m.default),
};

let activePackId: SoundPackId = DEFAULT_SOUND_PACK;
let definitions: SoundPack = cartucho;

/**
 * Troca o pacote ativo. Até o novo chegar, os sons seguem no anterior; se ele não carregar
 * (offline, por exemplo), fica o anterior.
 */
export async function setSoundPack(id: SoundPackId): Promise<void> {
  if (id === activePackId) return;
  activePackId = id;
  try {
    const pack = await soundPackLoaders[id]();
    if (activePackId !== id) return; // trocou de novo enquanto carregava
    definitions = pack;
    buffers.clear();
  } catch (error) {
    reportAudioError(error);
  }
}

interface AudioOutput {
  context: AudioContext;
  /** Volume do usuário, aplicado a todos os sons. */
  master: GainNode;
}

let output: AudioOutput | null = null;
const buffers = new Map<SoundName, AudioBuffer>();

// Política de autoplay: o AudioContext só nasce depois de o usuário interagir com a página.
let userHasInteracted = false;
const UNLOCK_EVENTS = ["pointerdown", "keydown"] as const;

function unlock() {
  userHasInteracted = true;
  for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, true);
}

if (typeof window !== "undefined") {
  for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, true);
}

function getOutput(): AudioOutput | null {
  if (output) return output;
  if (!userHasInteracted) return null;
  const context = new AudioContext();
  const master = context.createGain();
  master.connect(context.destination);
  output = { context, master };
  return output;
}

function getBuffer(context: AudioContext, name: SoundName): AudioBuffer {
  const cached = buffers.get(name);
  if (cached) return cached;
  const buffer = sfxr.toWebAudio(definitions[name], context).buffer;
  if (!buffer) throw new Error(`jsfxr não gerou o som "${name}"`);
  buffers.set(name, buffer);
  return buffer;
}

function reportAudioError(error: unknown) {
  if (process.env.NODE_ENV !== "production") console.debug("[audio] som ignorado:", error);
}

/**
 * Toca um som com volume de 0 a 1. Nunca lança: sem interação ainda, aba em segundo plano
 * ou qualquer falha do navegador, o som simplesmente não toca.
 */
export function playSound(name: SoundName, volume: number): void {
  try {
    if (document.hidden) return;
    const audio = getOutput();
    if (!audio) return;
    const { context, master } = audio;
    // Suspenso (ex.: celular voltando do bloqueio): o start() abaixo toca assim que retomar.
    if (context.state !== "running") context.resume().catch(reportAudioError);

    master.gain.setValueAtTime(volume, context.currentTime);
    const source = context.createBufferSource();
    source.buffer = getBuffer(context, name);
    source.connect(master);
    source.start();
  } catch (error) {
    reportAudioError(error);
  }
}

/**
 * Toca um som de um pacote sem trocar o pacote ativo (o "ouvir" da loja). Sintetiza na hora,
 * sem cache: é raro. Nunca lança.
 */
export async function previewSound(pack: SoundPackId, name: SoundName, volume: number) {
  try {
    const audio = getOutput();
    if (!audio) return;
    const packDefinitions = await soundPackLoaders[pack]();
    const { context, master } = audio;
    if (context.state !== "running") await context.resume();
    master.gain.setValueAtTime(volume, context.currentTime);
    const source = sfxr.toWebAudio(packDefinitions[name], context);
    source.connect(master);
    source.start();
  } catch (error) {
    reportAudioError(error);
  }
}
