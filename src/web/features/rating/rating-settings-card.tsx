import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { BLEND_WEIGHT, ratingModeShortLabels, ratingModes } from "@shared/ratings";
import type { Settings } from "@shared/settings";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useUpdateSettings } from "@/lib/queries";

// Seção "Avaliação" dos ajustes: como sai a nota final, o peso da mistura e os pesos padrão.
// Vale para as avaliações novas: as antigas guardam os pesos e a nota com que foram feitas.

const modeOptions = ratingModes.map((mode) => ({
  value: mode,
  label: ratingModeShortLabels[mode],
}));

export function RatingSettingsCard({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [blend, setBlend] = useState(Math.round(settings.ratingBlendWeight * 100));

  return (
    <Card>
      <div className="space-y-1">
        <h2 className="display-xs">⭐ Avaliação</h2>
        <p className="text-sm text-muted-foreground">
          Como sai a nota final das avaliações guiadas. Vale para as novas: as antigas mantêm a nota
          com que foram salvas.{" "}
          <Link to="/como-avaliamos" className="text-info underline">
            Como avaliamos
          </Link>
        </p>
      </div>

      <SegmentedToggle
        legend="Nota final"
        options={modeOptions}
        value={settings.ratingMode}
        onChange={(ratingMode) => update.mutate({ ratingMode })}
      />

      {settings.ratingMode === "blend" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>Peso da calculada na mistura</span>
            <span className="text-muted-foreground tabular-nums">
              {blend}% calculada · {100 - blend}% coração
            </span>
          </div>
          <Slider
            thumbLabel="Peso da nota calculada"
            min={BLEND_WEIGHT.min * 100}
            max={BLEND_WEIGHT.max * 100}
            step={BLEND_WEIGHT.step * 100}
            value={[blend]}
            onValueChange={([v = blend]) => setBlend(v)}
            onValueCommit={([v = blend]) => update.mutate({ ratingBlendWeight: v / 100 })}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {settings.ratingCustomWeights
            ? "Pesos padrão: os seus (salvos no resumo de uma avaliação)."
            : "Pesos padrão: os do método. Ajuste no resumo de uma avaliação e salve como padrão."}
        </p>
        {settings.ratingCustomWeights && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate({ ratingCustomWeights: null })}
          >
            Voltar aos pesos do método
          </Button>
        )}
      </div>
    </Card>
  );
}
