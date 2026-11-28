import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** Barra contínua com moldura fina de tinta (quando a precisão importa). */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        "relative m-0.5 h-4 w-[calc(100%-4px)] overflow-hidden rounded-control bg-muted p-0.5 pixel-frame-thin [--px-frame-color:var(--foreground)]",
        className,
      )}
      {...props}
    >
      <div className="h-full w-full overflow-hidden">
        <ProgressPrimitive.Indicator
          className="h-full w-full bg-primary transition-transform ease-(--ease-progress)"
          style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
        />
      </div>
    </ProgressPrimitive.Root>
  );
}

const xpTones = {
  primary: "bg-primary",
  finished: "bg-status-finished",
  info: "bg-info",
} as const;

interface XpBarProps {
  /** 0–100 */
  value: number;
  cells?: number;
  tone?: keyof typeof xpTones;
  label?: string;
  className?: string;
}

/** Barra de XP segmentada: cada célula vale 100/cells %, arredondado. Sempre acompanhe do número. */
function XpBar({
  value,
  cells = 10,
  tone = "primary",
  label = "Progresso",
  className,
}: XpBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const on = Math.round((clamped / 100) * cells);
  return (
    <ProgressPrimitive.Root
      data-slot="xp-bar"
      value={Math.round(clamped)}
      aria-label={label}
      className={cn(
        "m-0.5 grid h-4 min-w-16 flex-1 gap-(--xp-gap) overflow-hidden rounded-control bg-muted p-0.5 pixel-frame-thin [--px-frame-color:var(--foreground)]",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${cells}, 1fr)` }}
    >
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={i < on ? xpTones[tone] : undefined} />
      ))}
    </ProgressPrimitive.Root>
  );
}

export { Progress, XpBar };
