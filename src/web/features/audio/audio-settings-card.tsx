import { useId } from "react";
import { PlayIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAudioSettings } from "./audio-settings-store";
import { soundLabels, soundNames } from "./sounds";
import { useSound } from "./use-sound";

/** Seção "Áudio" dos ajustes: liga/desliga, volume e prévia de cada som (salvos neste aparelho). */
export function AudioSettingsCard() {
  const { enabled, volume, setEnabled, setVolume } = useAudioSettings();
  const { play } = useSound();
  const switchId = useId();
  const percent = Math.round(volume * 100);

  return (
    <Card>
      <div className="space-y-1">
        <h2 className="display-xs">🔊 Áudio</h2>
        <p className="text-sm text-muted-foreground">
          Sons ao começar e parar sessões, zerar jogos e bater marcos, no estilo do seu tema. Ligar,
          desligar e o volume valem só para este aparelho.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={switchId}>Efeitos sonoros</Label>
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            if (checked) play("session-start");
          }}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <span className={`display-xs ${enabled ? "" : "text-muted-foreground"}`} aria-hidden>
            Volume
          </span>
          <span className="display-xs tabular-nums text-muted-foreground" aria-hidden>
            {percent}%
          </span>
        </div>
        <Slider
          thumbLabel="Volume"
          min={0}
          max={100}
          step={5}
          value={[percent]}
          disabled={!enabled}
          onValueChange={([value = percent]) => setVolume(value / 100)}
          onValueCommit={() => play("session-start")}
        />
      </div>

      <ul className="space-y-1" aria-label="Sons">
        {soundNames.map((name) => (
          <li key={name} className="flex items-center justify-between gap-2">
            <span className={enabled ? undefined : "text-muted-foreground"}>
              {soundLabels[name]}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!enabled}
              aria-label={`Ouvir: ${soundLabels[name]}`}
              onClick={() => play(name)}
            >
              <PlayIcon /> Ouvir
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
