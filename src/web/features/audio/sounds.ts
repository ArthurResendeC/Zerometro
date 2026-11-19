import { sfxr } from "jsfxr";
import definitions from "./zerometro-sfx.json";

// Efeitos sonoros 8 bits, sintetizados no navegador pelo jsfxr a partir do JSON (nada de .wav no repo).
// Cada som é gerado uma vez só, no primeiro play, e o AudioBuffer fica em cache na memória.

export type SoundName = keyof typeof definitions;

/** Nome de cada som na tela de ajustes (o Record garante que nenhum som do JSON fique de fora). */
export const soundLabels: Record<SoundName, string> = {
  "session-start": "Começou a jogar",
  "session-stop": "Parou de jogar",
  "game-finished": "Jogo zerado",
  "streak-milestone": "Marco da ofensiva",
  "goal-reached": "Meta do ano batida",
};

export const soundNames = Object.keys(soundLabels) as SoundName[];

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
