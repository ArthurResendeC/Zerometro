import { themeIds, themes } from "@shared/themes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTheme } from "@/lib/theme";
import { ThemeOption } from "./theme-option";

/**
 * Prévia de todos os temas, só em desenvolvimento: mostra sem salvar na conta (a loja vai usar a
 * mesma prévia). Some do build de produção (NODE_ENV fica fixo no bundle).
 */
export function ThemePreviewCard() {
  const { activeId, previewId, startPreview, endPreview } = useTheme();

  return (
    <Card>
      <div className="space-y-1">
        <h2 className="display-xs">🧪 Prévia de temas (desenvolvimento)</h2>
        <p className="text-sm text-muted-foreground">
          Só aparece fora de produção. Mostra o tema sem salvar na conta, até você voltar.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {themeIds.map((id) => (
          <li key={id}>
            <ThemeOption
              theme={themes[id]}
              active={activeId === id}
              onSelect={() => startPreview(id)}
            />
          </li>
        ))}
      </ul>
      {previewId && (
        <div>
          <Button variant="outline" size="sm" onClick={endPreview}>
            Voltar ao tema da conta
          </Button>
        </div>
      )}
    </Card>
  );
}
