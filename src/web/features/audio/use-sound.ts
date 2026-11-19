import { useAudioSettings } from "./audio-settings-store";
import { pickSound } from "./sound-events";
import { playSound, type SoundName } from "./sounds";

/** Toca o som se os efeitos estiverem ligados, no volume escolhido. Nunca lança. */
function play(name: SoundName): void {
  // Lido na hora do play (e não por assinatura): sempre o valor atual, sem re-render.
  const { enabled, volume } = useAudioSettings.getState();
  if (enabled && volume > 0) playSound(name, volume);
}

/** Uma ação pode disparar vários eventos: toca só o mais importante (ver `pickSound`). */
function playMostImportant(events: Parameters<typeof pickSound>[0]): void {
  const sound = pickSound(events);
  if (sound) play(sound);
}

/**
 * `play(name)` respeita as configurações de áudio e nunca lança; chame no `onSuccess` das
 * mutations (depois da resposta do servidor), nunca antes.
 */
export function useSound() {
  return { play, playMostImportant };
}
