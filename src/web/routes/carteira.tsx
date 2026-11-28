import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  achievementTiers,
  COINS_PER_HOUR,
  type CoinEntry,
  DAILY_PLAYTIME_CAP_MINUTES,
  playtimeCoins,
} from "@shared/economy";
import { CoinIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { formatCount, formatDate, formatMinutes } from "@/lib/format";
import { walletQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/carteira")({
  loader: ({ context }) => context.queryClient.ensureQueryData(walletQuery()),
  component: WalletPage,
});

function WalletPage() {
  const { data: wallet } = useSuspenseQuery(walletQuery());

  return (
    // gap, não space-y: a margem da moldura do Card anularia a do space-y.
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="display-lg">Carteira</h1>
        <p className="mt-2 text-muted-foreground">
          Moedas para trocar por temas e sons. A loja abre em breve.
        </p>
      </div>

      <Card>
        <div className="flex items-center gap-3">
          <CoinIcon className="size-8 text-coin" />
          <span className="display-xl tabular-nums">{formatCount(wallet.balance)}</span>
          <span className="text-muted-foreground">moedas</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatCount(wallet.earned.playtime)} de horas jogadas ·{" "}
          {formatCount(wallet.earned.achievement)} de conquistas · rendendo desde{" "}
          {formatDate(wallet.since)}, o seu cadastro.
        </p>
      </Card>

      <Card>
        <h2 className="display-xs">Como ganhar</h2>
        <div className="space-y-1">
          <p>
            <strong>Horas jogadas:</strong> {COINS_PER_HOUR} moedas por hora, até{" "}
            {formatMinutes(DAILY_PLAYTIME_CAP_MINUTES)} por dia (
            {playtimeCoins(DAILY_PLAYTIME_CAP_MINUTES)} moedas). Vale timer, sessão registrada e o
            tempo que vem da Steam.
          </p>
        </div>
        <div className="space-y-2">
          <p>
            <strong>Conquistas da Steam</strong> sincronizadas, pela raridade:
          </p>
          <ul className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {achievementTiers.map((tier) => (
              <li key={tier.maxRarity} className="contents">
                <span className="text-muted-foreground">{tier.label}</span>
                <span className="flex items-center justify-end gap-1 tabular-nums">
                  {tier.coins} <CoinIcon className="text-coin" />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">
          Só rende o que aconteceu depois do cadastro: o tempo &quot;antes do Zerômetro&quot; e as
          conquistas marcadas à mão ficam de fora. Editar ou apagar uma sessão ajusta o saldo.
        </p>
      </Card>

      <Card>
        <h2 className="display-xs">Histórico</h2>
        {wallet.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada ainda: jogue um pouco ou sincronize as conquistas da Steam.
          </p>
        ) : (
          <ol className="divide-y-(length:--rule) divide-border">
            {wallet.entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block">{describe(entry)}</span>
                  {/* As horas já dizem o dia; a data do lançamento só aparece no resto. */}
                  {(entry.reason !== "playtime" || entry.details.adjustment) && (
                    <span className="text-sm text-muted-foreground">
                      {formatDate(entry.createdAt.slice(0, 10))}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "display-xs tabular-nums",
                    entry.amount > 0 ? "text-score-good" : "text-destructive",
                  )}
                >
                  {entry.amount > 0 ? "+" : "−"}
                  {formatCount(Math.abs(entry.amount))}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/** "1h 30min de jogo em 27/11/2026", "Conquista "Final verdadeiro" · Persona 5 Royal (8%)". */
function describe({ reason, details }: CoinEntry): string {
  switch (reason) {
    case "playtime": {
      const day = details.day ? formatDate(details.day) : "";
      if (!details.adjustment) return `${formatMinutes(details.minutes ?? 0)} de jogo em ${day}`;
      return details.minutes
        ? `Ajuste: sessões de ${day} editadas (agora ${formatMinutes(details.minutes)})`
        : `Ajuste: sessões de ${day} apagadas`;
    }
    case "achievement": {
      if (!details.title) return "Ajuste: conquista removida";
      const game = details.game ? ` · ${details.game}` : "";
      const rarity = details.rarity == null ? "" : ` (${details.rarity}%)`;
      return `${details.adjustment ? "Ajuste: conquista" : "Conquista"} "${details.title}"${game}${rarity}`;
    }
    case "purchase":
      return "Compra na loja";
    case "grant":
      return "Moedas concedidas";
  }
}
