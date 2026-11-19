import { type Rhythm, sessionLengthBuckets } from "@shared/stats";
import { Card } from "@/components/ui/card";
import { formatMinutes } from "@/lib/format";
import { ColumnChart } from "./column-chart";

// Ritmo: em que dia da semana e em que horário eu jogo, e quanto duram as sessões.

const WEEKDAYS = [
  ["seg", "Segunda"],
  ["ter", "Terça"],
  ["qua", "Quarta"],
  ["qui", "Quinta"],
  ["sex", "Sexta"],
  ["sáb", "Sábado"],
  ["dom", "Domingo"],
] as const;

function bucketLabel({ min, max }: (typeof sessionLengthBuckets)[number]): string {
  if (min === 0) return `< ${formatMinutes(max ?? 0)}`;
  if (max === null) return `${formatMinutes(min)}+`;
  return `${formatMinutes(min)}–${formatMinutes(max)}`;
}

export function RhythmSection({ rhythm }: { rhythm: Rhythm }) {
  const busiest = rhythm.weekdays.reduce((a, b) => (b.avgMinutes > a.avgMinutes ? b : a));

  return (
    <section className="space-y-4" aria-labelledby="ritmo">
      <h2 id="ritmo" className="display-md">
        Ritmo
      </h2>
      <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
        <Card className="gap-3">
          <div>
            <h3 className="display-xs text-muted-foreground">Média por dia da semana</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {busiest.avgMinutes > 0
                ? `${WEEKDAYS[busiest.weekday]![1]} é o dia em que você mais joga.`
                : "Contando os dias em que não jogou."}
            </p>
          </div>
          <ColumnChart
            caption="Média de minutos jogados por dia da semana"
            data={rhythm.weekdays.map((w) => ({
              key: String(w.weekday),
              label: WEEKDAYS[w.weekday]![0],
              value: w.avgMinutes,
              title: `${WEEKDAYS[w.weekday]![1]} (média)`,
            }))}
          />
        </Card>

        <Card className="gap-3">
          <div>
            <h3 className="display-xs text-muted-foreground">Duração das sessões</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {rhythm.medianSessionMinutes === null
                ? "Nenhuma sessão nesse período."
                : `Metade das sessões dura até ${formatMinutes(rhythm.medianSessionMinutes)}.`}
            </p>
          </div>
          <ColumnChart
            unit="sessions"
            caption="Sessões por faixa de duração"
            data={sessionLengthBuckets.map((bucket, i) => ({
              key: String(bucket.min),
              label: bucketLabel(bucket),
              value: rhythm.sessionLengths[i] ?? 0,
              title: `Sessões de ${bucketLabel(bucket)}`,
            }))}
          />
        </Card>

        <Card className="gap-3 lg:col-span-2">
          <div>
            <h3 className="display-xs text-muted-foreground">Hora do dia</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {rhythm.timerSessions > 0
                ? `Só sessões com timer (${rhythm.timerSessions} nesse período): as registradas à mão não têm horário.`
                : "Use o timer (Comecei a jogar / Parei) para ver em que horário você joga."}
            </p>
          </div>
          {rhythm.timerSessions > 0 && (
            <ColumnChart
              caption="Minutos jogados em cada hora do dia"
              data={rhythm.hours.map((h) => ({
                key: String(h.hour),
                label: `${h.hour}h`,
                value: h.minutes,
                title: `Das ${h.hour}h às ${(h.hour + 1) % 24}h`,
              }))}
            />
          )}
        </Card>
      </div>
    </section>
  );
}
