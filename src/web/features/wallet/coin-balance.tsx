import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CoinIcon } from "@/components/icons";
import { formatCount } from "@/lib/format";
import { walletQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Saldo de moedas no menu, levando à carteira. Some até o saldo chegar. */
export function CoinBalance({ className }: { className?: string }) {
  const { data } = useQuery(walletQuery());
  if (!data) return null;
  return (
    <Link
      to="/carteira"
      aria-label={`Carteira: ${data.balance} moedas`}
      title="Carteira"
      className={cn(
        "flex h-9 items-center gap-1.5 px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:text-foreground",
        className,
      )}
    >
      <CoinIcon className="text-coin" />
      <span className="display-xs tabular-nums">{formatCount(data.balance)}</span>
    </Link>
  );
}
