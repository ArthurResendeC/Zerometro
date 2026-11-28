import { useId } from "react";
import type { Settings } from "@shared/settings";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateSettings } from "@/lib/queries";

/** "Aparecer no grupo": entrar no ranking e deixar os amigos verem o perfil. */
export function GroupSettingsCard({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const id = useId();
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
        Os amigos desta instância veem você no ranking e no seu perfil: o que está jogando, o que
        zerou (com a nota), as horas, as conquistas e a ofensiva. Nunca o preço pago, as notas das
        sessões nem o "onde parei". Desligado, você continua vendo o grupo, mas sai dele.
      </p>
    </Card>
  );
}
