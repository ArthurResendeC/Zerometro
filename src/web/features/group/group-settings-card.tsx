import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import {
  type GroupSectionInfo,
  groupSectionsByTab,
  groupTabLabels,
  groupTabs,
  isSectionShared,
} from "@shared/group-sections";
import type { Settings } from "@shared/settings";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { sessionQuery, useUpdateSettings } from "@/lib/queries";

/** "Aparecer no grupo" e, seção por seção, o que os amigos veem no seu perfil do grupo. */
export function GroupSettingsCard({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const { data: session } = useQuery(sessionQuery());
  const id = useId();
  const handle = session?.handle;

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id}>🏆 Aparecer no grupo</Label>
        <Switch
          id={id}
          checked={settings.shareWithGroup}
          disabled={update.isPending}
          onCheckedChange={(checked) => update.mutate({ shareWithGroup: checked })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Os amigos desta instância veem você no ranking (horas, zerados, conquistas e ofensiva) e, no
        seu perfil do grupo, só as seções que você deixar ligadas abaixo. Nunca as notas das sessões
        nem o "onde parei". Desligado, você continua vendo o grupo, mas sai dele.
      </p>

      {settings.shareWithGroup && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            O que aparece no seu perfil do grupo
          </summary>
          <div className="mt-3 space-y-4">
            {groupTabs.map((tab) => (
              <fieldset key={tab} className="space-y-2">
                {/* Flutuando, a legenda aceita margem como um bloco comum. */}
                <legend className="display-xs float-left w-full pt-2 pb-2 text-muted-foreground">
                  {groupTabLabels[tab]}
                </legend>
                {groupSectionsByTab[tab].map((info) => (
                  <SectionSwitch
                    key={info.section}
                    info={info}
                    checked={isSectionShared(settings.groupSections, info.section)}
                    disabled={update.isPending}
                    onChange={(checked) =>
                      update.mutate({
                        groupSections: { ...settings.groupSections, [info.section]: checked },
                      })
                    }
                  />
                ))}
              </fieldset>
            ))}
            {handle && (
              <Link
                to="/amigo/$handle"
                params={{ handle }}
                className="inline-block text-sm text-info underline"
              >
                Ver como os amigos veem
              </Link>
            )}
          </div>
        </details>
      )}
    </Card>
  );
}

function SectionSwitch({
  info,
  checked,
  disabled,
  onChange,
}: {
  info: GroupSectionInfo;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="clear-both flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">
          {info.label}
        </Label>
        {info.hint && <p className="text-xs text-muted-foreground">{info.hint}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
