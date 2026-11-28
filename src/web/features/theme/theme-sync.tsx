import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { setSoundPack } from "@/features/audio/sounds";
import { settingsQuery } from "@/lib/queries";
import { activeSoundPack, useTheme } from "@/lib/theme";

/**
 * Liga o tema e o pacote de sons aos ajustes da conta: quando os ajustes chegam (ou mudam em
 * outro aparelho), aplica. Uma prévia em andamento continua por cima. Não renderiza nada.
 */
export function ThemeSync() {
  const { data: settings } = useQuery(settingsQuery());
  const setAccount = useTheme((state) => state.setAccount);
  const soundPack = useTheme(activeSoundPack);

  useEffect(() => {
    if (settings) setAccount(settings.themeId, settings.soundPackId);
  }, [settings, setAccount]);

  useEffect(() => {
    void setSoundPack(soundPack);
  }, [soundPack]);

  return null;
}
