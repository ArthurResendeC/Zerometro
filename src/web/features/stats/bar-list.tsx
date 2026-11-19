import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatMinutes } from "@/lib/format";

// Lista de barras horizontais (uma série só): nome e valor em texto, barra fina embaixo.
// Os valores ficam sempre visíveis, então não precisa de tooltip nem tabela à parte.

export interface BarListItem {
  key: string | number;
  label: ReactNode;
  minutes: number;
  /** Texto secundário ao lado do nome (ex.: "3 jogos"). */
  hint?: ReactNode;
  /** Algo antes do nome (ex.: a capa). */
  leading?: ReactNode;
  /** A linha vira link para a página do jogo. */
  gameId?: number;
}

interface BarListProps {
  items: BarListItem[];
  /** Cor da barra (token). */
  color?: string;
}

export function BarList({ items, color = "var(--chart-2)" }: BarListProps) {
  const max = Math.max(...items.map((i) => i.minutes), 1);
  return (
    <ol className="space-y-3">
      {items.map((item) => {
        const row = (
          <div className="flex items-center gap-3">
            {item.leading}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  {item.label}
                  {item.hint && (
                    <span className="ml-2 text-xs text-muted-foreground">{item.hint}</span>
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatMinutes(item.minutes)}
                </span>
              </div>
              <div className="h-2 bg-muted" aria-hidden>
                <div
                  className="h-full"
                  style={{ width: `${(item.minutes / max) * 100}%`, background: color }}
                />
              </div>
            </div>
          </div>
        );
        return (
          <li key={item.key}>
            {item.gameId === undefined ? (
              row
            ) : (
              <Link
                to="/jogos/$gameId"
                params={{ gameId: item.gameId }}
                className="-m-1 block p-1 hover:bg-accent"
              >
                {row}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
