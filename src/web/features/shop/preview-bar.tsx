import { useQuery } from "@tanstack/react-query";
import { themes } from "@shared/themes";
import { Button } from "@/components/ui/button";
import { shopQuery } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import { PurchaseButton } from "./purchase-button";

/**
 * Faixa fixa enquanto um tema está em prévia: dá para navegar pelo app inteiro com ele e, dali
 * mesmo, comprar ou voltar ao tema da conta.
 */
export function PreviewBar() {
  const { previewId, endPreview } = useTheme();
  const { data: shop } = useQuery({ ...shopQuery(), enabled: previewId !== null });
  if (!previewId) return null;

  const item = shop?.items.find((i) => i.kind === "theme" && i.id === previewId);
  return (
    <output className="sticky bottom-0 z-40 block border-t-(length:--rule-thick) border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <p className="mr-auto">
          <span className="text-muted-foreground">Prévia: </span>
          {themes[previewId].name}
        </p>
        {item && !item.owned && item.price !== null && shop && (
          <PurchaseButton item={{ ...item, price: item.price }} balance={shop.balance} />
        )}
        <Button size="sm" variant="outline" onClick={endPreview}>
          Voltar ao meu tema
        </Button>
      </div>
    </output>
  );
}
