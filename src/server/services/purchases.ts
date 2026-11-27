import type { LibraryItem } from "../../shared/library";
import {
  type CostPerHourGame,
  MIN_MINUTES_FOR_COST,
  type PurchaseGame,
  type PurchaseMonth,
  type PurchaseStats,
} from "../../shared/purchases";
import type { StatsPeriod } from "../../shared/stats";
import type { UserScope } from "./context";
import { listLibrary } from "./library";
import { finishedInPeriod, nextMonth, statsPeriodRange } from "./stats";

/**
 * Comprei × zerei no período (o mesmo recorte do heatmap) e o custo por hora de todas as
 * compras com preço.
 */
export function getPurchaseStats(
  scope: UserScope,
  { today, year }: { today: string } & StatsPeriod,
): PurchaseStats {
  const { from, to } = statsPeriodRange(today, year);
  const until = to > today ? today : to;
  const items = listLibrary(scope);

  const months = new Map<string, PurchaseMonth>();
  for (let month = from.slice(0, 7); month <= until.slice(0, 7); month = nextMonth(month)) {
    months.set(month, { month, bought: 0, finished: 0, spentCents: 0 });
  }

  let bought = 0;
  let viaSubscription = 0;
  let spentCents = 0;
  for (const item of items) {
    const acquiredOn = item.purchase?.acquiredOn;
    if (!acquiredOn || acquiredOn < from || acquiredOn > until) continue;
    const price = item.purchase!.pricePaidCents ?? 0;
    bought++;
    if (item.purchase!.viaSubscription) viaSubscription++;
    spentCents += price;
    const month = months.get(acquiredOn.slice(0, 7));
    if (month) {
      month.bought++;
      month.spentCents += price;
    }
  }

  const { firstInPeriod } = finishedInPeriod(scope, from, until);
  for (const date of firstInPeriod.values()) {
    const month = months.get(date.slice(0, 7));
    if (month) month.finished++;
  }

  const costPerHour: CostPerHourGame[] = items
    .filter(
      (item) =>
        item.purchase &&
        !item.purchase.viaSubscription &&
        (item.purchase.pricePaidCents ?? 0) > 0 &&
        item.minutesPlayed >= MIN_MINUTES_FOR_COST,
    )
    .map((item) => {
      const pricePaidCents = item.purchase!.pricePaidCents!;
      return Object.assign(purchaseGame(item), {
        pricePaidCents,
        centsPerHour: Math.round((pricePaidCents * 60) / item.minutesPlayed),
      });
    })
    .toSorted((a, b) => a.centsPerHour - b.centsPerHour || a.name.localeCompare(b.name));
  const pricedCents = costPerHour.reduce((sum, game) => sum + game.pricePaidCents, 0);
  const pricedMinutes = costPerHour.reduce((sum, game) => sum + game.minutesPlayed, 0);

  const unplayed = items
    .filter(
      (item) =>
        item.purchase &&
        !item.purchase.viaSubscription &&
        item.minutesPlayed === 0 &&
        !item.completion,
    )
    .map(purchaseGame)
    .toSorted(
      (a, b) =>
        (a.acquiredOn ?? "").localeCompare(b.acquiredOn ?? "") || a.name.localeCompare(b.name),
    );

  return {
    from,
    to,
    year: year ?? null,
    hasPurchases: items.some((item) => item.purchase),
    bought,
    viaSubscription,
    spentCents,
    finished: firstInPeriod.size,
    byMonth: [...months.values()],
    costPerHour,
    averageCentsPerHour: pricedMinutes > 0 ? Math.round((pricedCents * 60) / pricedMinutes) : null,
    unplayed,
    unplayedCents: unplayed.reduce((sum, game) => sum + (game.pricePaidCents ?? 0), 0),
  };
}

function purchaseGame(item: LibraryItem): PurchaseGame {
  return {
    gameId: item.gameId,
    igdbId: item.igdbId,
    name: item.name,
    coverImageId: item.coverImageId,
    acquiredOn: item.purchase?.acquiredOn ?? null,
    pricePaidCents: item.purchase?.pricePaidCents ?? null,
    store: item.purchase?.store ?? null,
    minutesPlayed: item.minutesPlayed,
  };
}
