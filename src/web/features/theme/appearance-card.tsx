import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { isSoundPackId, soundPacks, themeSoundPack } from "@shared/items";
import type { Settings } from "@shared/settings";
import { isThemeId, themes } from "@shared/themes";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { itemsQuery, useUpdateSettings } from "@/lib/queries";
import { ThemeOption } from "./theme-option";

/** Aparência: o tema e o pacote de sons da conta, entre os que o perfil tem; mais na loja. */
export function AppearanceCard({ settings }: { settings: Settings }) {
  const { data: items = [] } = useQuery(itemsQuery());
  const update = useUpdateSettings();
  const soundId = useId();

  const ownedThemes = items.flatMap((i) =>
    i.kind === "theme" && isThemeId(i.itemId) ? [i.itemId] : [],
  );
  const ownedPacks = items.flatMap((i) =>
    i.kind === "sound_pack" && isSoundPackId(i.itemId) ? [i.itemId] : [],
  );

  const themePack = soundPacks[themeSoundPack[settings.themeId]];

  return (
    <Card>
      <div className="space-y-1">
        <h2 className="display-xs">🎨 Aparência</h2>
        <p className="text-sm text-muted-foreground">
          O tema e os sons da sua conta, em todos os aparelhos.{" "}
          <Link to="/loja" className="text-primary underline-offset-4 hover:underline">
            Mais temas na loja
          </Link>
          .
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {ownedThemes.map((id) => (
          <li key={id}>
            <ThemeOption
              theme={themes[id]}
              active={settings.themeId === id}
              disabled={update.isPending}
              onSelect={() => update.mutate({ themeId: id })}
            />
          </li>
        ))}
      </ul>
      {ownedPacks.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor={soundId}>Sons</Label>
          <NativeSelect
            id={soundId}
            value={settings.soundPackId ?? ""}
            disabled={update.isPending}
            onChange={(event) => {
              const value = event.target.value;
              update.mutate({ soundPackId: isSoundPackId(value) ? value : null });
            }}
          >
            <option value="">Os do tema ({themePack.name})</option>
            {ownedPacks.map((id) => (
              <option key={id} value={id}>
                {soundPacks[id].name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </Card>
  );
}
