import type { ShopItem } from "@shared/items";
import { CoinIcon } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { usePurchase } from "@/lib/queries";

/**
 * "Comprar · 250": confirma e compra (o que acontece depois, em `usePurchase`). Sem saldo, o botão
 * fica desabilitado e diz quanto falta.
 */
export function PurchaseButton({
  item,
  balance,
  size = "sm",
}: {
  item: ShopItem & { price: number };
  balance: number;
  size?: "sm" | "default";
}) {
  const purchase = usePurchase();
  const missing = item.price - balance;

  if (missing > 0) {
    return (
      <Button size={size} variant="secondary" disabled>
        Faltam {formatCount(missing)} <CoinIcon />
      </Button>
    );
  }

  const buy = () => purchase.mutate({ kind: item.kind, itemId: item.id });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size={size} disabled={purchase.isPending}>
          Comprar · {formatCount(item.price)} <CoinIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Comprar {item.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Custa {formatCount(item.price)} moedas. Você fica com{" "}
            {formatCount(balance - item.price)}.
            {item.kind === "theme" && " O tema entra em uso na hora, com os sons dele."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Agora não</AlertDialogCancel>
          <AlertDialogAction onClick={buy}>Comprar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
