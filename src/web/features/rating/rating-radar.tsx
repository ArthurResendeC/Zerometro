import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Tooltip } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { ratingCriteria, SCORE_MAX } from "@shared/rating-criteria";
import type { RatingScores } from "@shared/ratings";
import { ChartContainer, ChartTooltipBox } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// Radar das notas por critério (uma série só: sem legenda; o título da seção diz o que é).
// Só os critérios avaliados entram; com menos de 3, não há polígono e o radar não aparece.

interface RadarRow {
  label: string;
  question: string;
  score: number;
}

export function radarRows(scores: RatingScores): RadarRow[] {
  return ratingCriteria.flatMap((c) => {
    const score = scores[c.id];
    return typeof score === "number" ? [{ label: c.label, question: c.question, score }] : [];
  });
}

export function RatingRadar({
  scores,
  caption,
  className,
}: {
  scores: RatingScores;
  caption: string;
  className?: string;
}) {
  const rows = radarRows(scores);
  if (rows.length < 3) return null;

  return (
    <>
      <ChartContainer
        className={cn(
          "aspect-square h-auto max-h-80 [&_.recharts-polar-angle-axis-tick_text]:fill-muted-foreground [&_.recharts-polar-grid_line]:stroke-muted [&_.recharts-polar-grid_polygon]:stroke-muted",
          className,
        )}
      >
        <RadarChart
          data={rows}
          outerRadius="70%"
          margin={{ top: 8, right: 24, bottom: 8, left: 24 }}
        >
          <PolarGrid />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, SCORE_MAX]} tickCount={8} tick={false} axisLine={false} />
          <Tooltip isAnimationActive={false} content={RadarTooltip} cursor={false} />
          <Radar
            dataKey="score"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="var(--chart-1)"
            fillOpacity={0.25}
            dot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </RadarChart>
      </ChartContainer>
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>
                  {row.score} de {SCORE_MAX}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RadarTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = payload?.[0]?.payload as RadarRow | undefined;
  if (!active || !row) return null;
  return <ChartTooltipBox value={`${row.score} de ${SCORE_MAX}`} label={row.label} />;
}
