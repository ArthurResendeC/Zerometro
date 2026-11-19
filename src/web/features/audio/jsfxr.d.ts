// Tipos mínimos do jsfxr (o pacote não traz os seus), só para o que o Zerômetro usa.
declare module "jsfxr" {
  /** Definição de som no formato JSON do jsfxr (`p_*`, `wave_type`, `sound_vol`, ...). */
  export type SfxrDefinition = Record<string, number | boolean>;

  export const sfxr: {
    /** Sintetiza o som e devolve uma fonte pronta para tocar (o `buffer` dela é reaproveitável). */
    toWebAudio(definition: SfxrDefinition, context: BaseAudioContext): AudioBufferSourceNode;
  };
}
