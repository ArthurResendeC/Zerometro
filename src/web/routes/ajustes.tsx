import { useForm } from "@tanstack/react-form";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { LONG_SESSION_MINUTES, type Settings, STREAK_MIN_MINUTES } from "@shared/settings";
import { DurationInput } from "@/components/duration-input";
import { UserAvatar } from "@/components/user-avatar";
import { FieldErrors } from "@/components/field-errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LogOutIcon } from "@/components/icons";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { formatMinutes } from "@/lib/format";
import { settingsQuery, useUpdateSettings } from "@/lib/queries";

export const Route = createFileRoute("/ajustes")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery()),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: settings } = useSuspenseQuery(settingsQuery());

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="display-lg">Ajustes</h1>
        <p className="mt-2 text-muted-foreground">Preferências do Zerômetro.</p>
      </div>
      <DurationSettingCard
        key={`streak-${settings.streakMinMinutes}`}
        field="streakMinMinutes"
        value={settings.streakMinMinutes}
        bounds={STREAK_MIN_MINUTES}
        presets={[15, 30, 60, 120]}
        title="🔥 Mínimo por dia para a ofensiva"
        description="Um dia só conta na ofensiva se você jogar pelo menos isso (somando todos os jogos)."
      />
      <DurationSettingCard
        key={`long-${settings.longSessionMinutes}`}
        field="longSessionMinutes"
        value={settings.longSessionMinutes}
        bounds={LONG_SESSION_MINUTES}
        presets={[180, 360, 480, 720]}
        title="⏱️ Aviso de sessão longa"
        description='Ao parar um timer ligado há mais que isso, o Zerômetro pergunta "jogou tudo isso mesmo?" e deixa corrigir o horário em que você parou.'
      />
      <AccountCard />
    </div>
  );
}

function AccountCard() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const { queryClient } = Route.useRouteContext();
  const [pending, setPending] = useState(false);

  if (!session) return null;

  const signOut = async () => {
    setPending(true);
    await authClient.signOut();
    // Nada do usuário anterior pode sobrar no cache.
    queryClient.clear();
    await router.navigate({ to: "/entrar" });
  };

  return (
    <Card className="flex flex-row items-center gap-3 p-4">
      <UserAvatar user={session.user} className="size-12" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg leading-6">{session.user.name}</p>
        <p className="truncate text-sm text-muted-foreground">{session.user.email}</p>
      </div>
      <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
        <LogOutIcon /> Sair
      </Button>
    </Card>
  );
}

interface DurationSettingCardProps {
  field: keyof Settings;
  value: number;
  bounds: { min: number; max: number };
  presets: number[];
  title: string;
  description: string;
}

function DurationSettingCard({
  field,
  value,
  bounds,
  presets,
  title,
  description,
}: DurationSettingCardProps) {
  const update = useUpdateSettings();
  const schema = z
    .object({ hours: z.number().int().min(0), minutes: z.number().int().min(0).max(59) })
    .refine((v) => v.hours * 60 + v.minutes >= bounds.min, {
      message: `Mínimo de ${formatMinutes(bounds.min)}`,
      path: ["minutes"],
    })
    .refine((v) => v.hours * 60 + v.minutes <= bounds.max, {
      message: `Máximo de ${formatMinutes(bounds.max)}`,
      path: ["hours"],
    });

  const form = useForm({
    defaultValues: { hours: Math.floor(value / 60), minutes: value % 60 },
    validators: { onSubmit: schema },
    onSubmit: async ({ value: v }) => {
      await update.mutateAsync({ [field]: v.hours * 60 + v.minutes });
    },
  });

  function setTotal(total: number) {
    form.setFieldValue("hours", Math.floor(total / 60));
    form.setFieldValue("minutes", total % 60);
  }

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <Label>{title}</Label>
          <p className="text-sm text-muted-foreground">
            {description} De {formatMinutes(bounds.min)} a {formatMinutes(bounds.max)}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form.Field name="hours">
            {(f) => (
              <DurationInput
                label="horas"
                max={Math.floor(bounds.max / 60)}
                value={f.state.value}
                onChange={f.handleChange}
                invalid={f.state.meta.errors.length > 0}
              />
            )}
          </form.Field>
          <form.Field name="minutes">
            {(f) => (
              <DurationInput
                label="min"
                max={59}
                value={f.state.value}
                onChange={f.handleChange}
                invalid={f.state.meta.errors.length > 0}
              />
            )}
          </form.Field>
          <div className="flex flex-wrap sm:ml-auto">
            {presets.map((minutes) => (
              <Button
                key={minutes}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTotal(minutes)}
              >
                {formatMinutes(minutes)}
              </Button>
            ))}
          </div>
        </div>
        <form.Subscribe
          selector={(s) => [
            ...(s.fieldMeta.hours?.errors ?? []),
            ...(s.fieldMeta.minutes?.errors ?? []),
          ]}
        >
          {(errors) => <FieldErrors errors={errors} />}
        </form.Subscribe>

        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Card>
  );
}
