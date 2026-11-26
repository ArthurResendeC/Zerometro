import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rótulo curto para o celular (padrão: o mesmo). */
  short?: string;
  Icon?: ComponentType;
}

interface SegmentedToggleProps<T extends string> {
  /** Nome do grupo para leitores de tela. */
  legend: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Botões colados numa moldura só, um ativo por vez (abas, ordem de um ranking…). */
export function SegmentedToggle<T extends string>({
  legend,
  options,
  value,
  onChange,
  className,
}: SegmentedToggleProps<T>) {
  return (
    <fieldset
      className={cn(
        "mt-1 mr-3 mb-3 ml-1 inline-flex bg-background pixel-frame pixel-frame-ink pixel-drop",
        className,
      )}
    >
      <legend className="sr-only">{legend}</legend>
      {options.map(({ value: option, label, short, Icon }) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-2 px-3 display-xs [&_svg]:size-3",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {Icon && <Icon />}
            {short ? (
              <>
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </>
            ) : (
              <span>{label}</span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
