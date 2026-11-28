import { themeIds, themes } from "@shared/themes";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/**
 * Prévia dos temas, só em desenvolvimento (ainda não há loja): troca o tema neste aparelho.
 * Some do build de produção (NODE_ENV fica fixo no bundle).
 */
export function ThemePreviewCard() {
  const { id: active, setTheme } = useTheme();

  return (
    <Card>
      <div className="space-y-1">
        <h2 className="display-xs">🎨 Tema (prévia de desenvolvimento)</h2>
        <p className="text-sm text-muted-foreground">
          Só aparece fora de produção. Vale para este aparelho.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {themeIds.map((id) => {
          const theme = themes[id];
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={active === id}
                onClick={() => setTheme(id)}
                className={cn(
                  "frame-space flex h-full w-[calc(100%-2*var(--frame-gap))] cursor-pointer flex-col gap-1 bg-background p-3 text-left pixel-frame-thin hover:bg-accent",
                  active === id && "[--px-frame-color:var(--primary)] bg-accent",
                )}
              >
                <span className="display-xs">{theme.name}</span>
                <span className="text-sm text-muted-foreground">{theme.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
