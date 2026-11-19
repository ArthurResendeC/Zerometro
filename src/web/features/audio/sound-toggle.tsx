import { VolumeOffIcon, VolumeOnIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAudioSettings } from "./audio-settings-store";
import { useSound } from "./use-sound";

/** Liga/desliga os efeitos sonoros (no cabeçalho). Ao ligar, toca uma prévia. */
export function SoundToggle({ className }: { className?: string }) {
  const enabled = useAudioSettings((s) => s.enabled);
  const setEnabled = useAudioSettings((s) => s.setEnabled);
  const { play } = useSound();
  const Icon = enabled ? VolumeOnIcon : VolumeOffIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={enabled}
      aria-label="Efeitos sonoros"
      title={enabled ? "Som ligado" : "Som desligado"}
      className={cn("size-9", !enabled && "text-muted-foreground", className)}
      onClick={() => {
        setEnabled(!enabled);
        if (!enabled) play("session-start");
      }}
    >
      <Icon />
    </Button>
  );
}
