import { useForm } from "@tanstack/react-form";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { type Settings, STREAK_MIN_MINUTES } from "@shared/settings";
import { DurationInput } from "@/components/duration-input";
import { FieldErrors } from "@/components/field-errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
        <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Preferências do Zerômetro.</p>
      </div>
      <StreakForm key={settings.streakMinMinutes} settings={settings} />
    </div>
  );
}

const streakFormSchema = z
  .object({ hours: z.number().int().min(0), minutes: z.number().int().min(0).max(59) })
  .refine((v) => v.hours * 60 + v.minutes >= STREAK_MIN_MINUTES.min, {
    message: `Mínimo de ${formatMinutes(STREAK_MIN_MINUTES.min)}`,
    path: ["minutes"],
  })
  .refine((v) => v.hours * 60 + v.minutes <= STREAK_MIN_MINUTES.max, {
    message: `Máximo de ${formatMinutes(STREAK_MIN_MINUTES.max)}`,
    path: ["hours"],
  });

const PRESETS = [15, 30, 60, 120];

function StreakForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const form = useForm({
    defaultValues: {
      hours: Math.floor(settings.streakMinMinutes / 60),
      minutes: settings.streakMinMinutes % 60,
    },
    validators: { onSubmit: streakFormSchema },
    onSubmit: async ({ value }) => {
      await update.mutateAsync({ streakMinMinutes: value.hours * 60 + value.minutes });
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
          <Label>🔥 Mínimo por dia para a ofensiva</Label>
          <p className="text-sm text-muted-foreground">
            Um dia só conta na ofensiva se você jogar pelo menos isso (somando todos os jogos). De{" "}
            {formatMinutes(STREAK_MIN_MINUTES.min)} a {formatMinutes(STREAK_MIN_MINUTES.max)}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form.Field name="hours">
            {(field) => (
              <DurationInput
                label="horas"
                max={12}
                value={field.state.value}
                onChange={field.handleChange}
                invalid={field.state.meta.errors.length > 0}
              />
            )}
          </form.Field>
          <form.Field name="minutes">
            {(field) => (
              <DurationInput
                label="min"
                max={59}
                value={field.state.value}
                onChange={field.handleChange}
                invalid={field.state.meta.errors.length > 0}
              />
            )}
          </form.Field>
          <div className="flex gap-1 sm:ml-auto">
            {PRESETS.map((minutes) => (
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
