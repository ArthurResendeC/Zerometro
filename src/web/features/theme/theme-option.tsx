import type { ThemeDef } from "@shared/themes";
import { cn } from "@/lib/utils";

/** Um tema para escolher: nome e descrição, com a moldura na cor primária quando ativo. */
export function ThemeOption({
  theme,
  active,
  disabled,
  onSelect,
}: {
  theme: ThemeDef;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "frame-space flex h-full w-[calc(100%-2*var(--frame-gap))] cursor-pointer flex-col gap-1 bg-background p-3 text-left pixel-frame-thin hover:bg-accent disabled:cursor-wait",
        active && "[--px-frame-color:var(--primary)] bg-accent",
      )}
    >
      <span className="display-xs">{theme.name}</span>
      <span className="text-sm text-muted-foreground">{theme.description}</span>
    </button>
  );
}
