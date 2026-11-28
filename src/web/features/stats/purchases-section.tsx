import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { formatBrl } from "@shared/money";
import {
  type CostPerHourGame,
  MIN_MINUTES_FOR_COST,
  type PurchaseMonth,
  type PurchaseStats,
} from "@shared/purchases";
import { GameCover } from "@/components/game-cover";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChartContainer } from "@/components/ui/chart";
import { formatDate, formatMinutes } from "@/lib/format";
import { BarList } from "./bar-list";
import { StatTile } from "./stat-tile";

// Comprei × zerei: quantos jogos entraram e quantos saíram da pilha por mês, quanto custou e
// quanto cada compra rendeu por hora. O preço é pessoal: esta seção não vai para o recap.

/** No card; o resto fica no modal "Ver todos". */
const COST_ROWS = 8;
/** Por página, no modal. */
const COST_PAGE = 10;

const SERIES = [
  { key: "bought", label: "Comprados", color: "var(--chart-2)" },
  { key: "finished", label: "Zerados", color: "var(--primary)" },
] as const;

const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

const games = (count: number) => `${count} ${count === 1 ? "jogo" : "jogos"}`;

/** `person`: o nome de quem está sendo visto (sem ele, o vazio ensina a registrar compras). */
export function PurchasesSection({
  purchases,
  person,
}: {
  purchases: PurchaseStats;
  person?: string;
}) {
  return (
    <section className="space-y-4" aria-labelledby="comprei-zerei">
      <h2 id="comprei-zerei" className="display-md">
        Comprei × zerei
      </h2>
      {purchases.hasPurchases ? (
        <Purchases purchases={purchases} />
      ) : person ? (
        <Card>
          <p className="text-sm text-muted-foreground">{person} não registrou nenhuma compra.</p>
        </Card>
      ) : (
        <NoPurchases />
      )}
    </section>
  );
}

function NoPurchases() {
  return (
    <Card className="gap-2">
      <p>Nenhuma compra registrada ainda.</p>
      <p className="text-sm text-muted-foreground">
        Informe quando, onde e por quanto comprou cada jogo em Detalhes, na página do jogo (ou peça
        para a IA: "comprei o Hades na Steam por 47,49"). Aqui aparecem os comprados contra os
        zerados de cada mês e quanto cada compra custou por hora jogada.
      </p>
    </Card>
  );
}

function Purchases({ purchases }: { purchases: PurchaseStats }) {
  const { bought, finished, spentCents, viaSubscription } = purchases;
  const balance = finished - bought;
  const { costPerHour } = purchases;
  const [showAll, setShowAll] = useState(false);

  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        <StatTile
          label="Comprados"
          value={bought}
          hint={viaSubscription > 0 ? `${viaSubscription} por assinatura` : "Pela data da compra"}
        />
        <StatTile label="Zerados" value={finished} hint="Pela primeira vez (sem os replays)" />
        <StatTile
          label="Gasto"
          value={formatBrl(spentCents)}
          hint={bought > 0 ? `Em ${games(bought - viaSubscription)} comprados` : "Nenhuma compra"}
        />
        <StatTile
          label="Saldo da pilha"
          value={balance > 0 ? `+${balance}` : balance < 0 ? `−${-balance}` : "0"}
          hint={
            balance > 0
              ? "Zerou mais do que comprou"
              : balance < 0
                ? "Comprou mais do que zerou"
                : "Empatado"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
        <Card className="gap-3">
          <div>
            <h3 className="display-xs text-muted-foreground">Por mês</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Jogos que entraram na pilha (comprados ou resgatados) e que saíram dela (zerados pela
              primeira vez).
            </p>
          </div>
          <MonthsChart months={purchases.byMonth} />
          {purchases.unplayed.length > 0 && <Unplayed purchases={purchases} />}
        </Card>

        <Card className="gap-4">
          <div>
            <h3 className="display-xs text-muted-foreground">Custo por hora</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {purchases.averageCentsPerHour === null
                ? `Aparece quando um jogo com preço passar de ${formatMinutes(MIN_MINUTES_FOR_COST)} jogada.`
                : `Média de ${formatBrl(purchases.averageCentsPerHour)}/h. Todas as compras com preço, de qualquer época, com ${formatMinutes(MIN_MINUTES_FOR_COST)} ou mais jogada.`}
            </p>
          </div>
          {costPerHour.length > 0 && <CostList games={costPerHour.slice(0, COST_ROWS)} />}
          {costPerHour.length > COST_ROWS && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setShowAll(true)}
            >
              Ver todos os {costPerHour.length}
            </Button>
          )}
          <Dialog open={showAll} onOpenChange={setShowAll}>
            {/* Desmonta ao fechar: abre sempre na primeira página, dos mais baratos. */}
            {showAll && <CostDialogContent purchases={purchases} />}
          </Dialog>
        </Card>
      </div>
    </>
  );
}

const maxCost = (list: CostPerHourGame[]) => Math.max(1, ...list.map((g) => g.centsPerHour));

/** Ranking de custo por hora; `start` é a posição do primeiro (para numerar as páginas). */
function CostList({
  games: list,
  max,
  start,
}: {
  games: CostPerHourGame[];
  /** Valor da barra cheia (padrão: o maior da lista). */
  max?: number;
  start?: number;
}) {
  return (
    <BarList
      max={max}
      items={list.map((game, i) => ({
        key: game.gameId,
        igdbId: game.igdbId,
        label: game.name,
        minutes: game.minutesPlayed,
        value: game.centsPerHour,
        display: `${formatBrl(game.centsPerHour)}/h`,
        hint: `${formatBrl(game.pricePaidCents)} · ${formatMinutes(game.minutesPlayed)}`,
        leading: (
          <>
            {start !== undefined && (
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {start + i}
              </span>
            )}
            <GameCover
              name={game.name}
              imageId={game.coverImageId}
              size="thumb"
              className="w-8 shrink-0"
            />
          </>
        ),
      }))}
    />
  );
}

type CostOrder = "cheap" | "expensive";

const costOrders = [
  { value: "cheap", label: "Mais baratos por hora", short: "Mais baratos" },
  { value: "expensive", label: "Mais caros por hora", short: "Mais caros" },
] as const;

/** Todas as compras do custo por hora, de 10 em 10, nas duas ordens. */
function CostDialogContent({ purchases }: { purchases: PurchaseStats }) {
  const [order, setOrder] = useState<CostOrder>("cheap");
  const [page, setPage] = useState(0);
  const all = order === "cheap" ? purchases.costPerHour : purchases.costPerHour.toReversed();
  const pages = Math.ceil(all.length / COST_PAGE);
  const first = page * COST_PAGE;
  const shown = all.slice(first, first + COST_PAGE);

  return (
    <DialogContent className="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>Custo por hora</DialogTitle>
        <DialogDescription>
          {games(all.length)} com preço e {formatMinutes(MIN_MINUTES_FOR_COST)} ou mais jogada
          {purchases.averageCentsPerHour !== null &&
            `, média de ${formatBrl(purchases.averageCentsPerHour)}/h`}
          .
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SegmentedToggle
          legend="Ordem"
          options={costOrders}
          value={order}
          onChange={(value) => {
            setOrder(value);
            setPage(0);
          }}
          className="mb-1"
        />
        {/* Em cima da lista, para não precisar rolar até o fim para trocar de página. */}
        {pages > 1 && (
          <nav aria-label="Páginas" className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="px-1 text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {first + 1}–{first + shown.length} de {all.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </nav>
        )}
      </div>

      {/* A mesma escala em todas as páginas: a barra cheia é o mais caro por hora. */}
      <CostList games={shown} max={maxCost(all)} start={first + 1} />
    </DialogContent>
  );
}

/** Comprados e ainda nunca jogados: a pilha da vergonha. */
function Unplayed({ purchases }: { purchases: PurchaseStats }) {
  return (
    <div className="space-y-2 border-t-2 border-muted pt-3">
      <p className="text-xs text-muted-foreground">
        {games(purchases.unplayed.length)} comprados e nunca jogados
        {purchases.unplayedCents > 0 && ` (${formatBrl(purchases.unplayedCents)})`}:
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {purchases.unplayed.map((game) => (
          <li key={game.gameId}>
            <Link
              to="/jogo/$igdbId"
              params={{ igdbId: game.igdbId }}
              className="underline decoration-dotted underline-offset-4 hover:text-primary"
            >
              {game.name}
            </Link>
            {game.acquiredOn && (
              <span className="text-xs text-muted-foreground">
                {" "}
                desde {formatDate(game.acquiredOn)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type MonthRow = PurchaseMonth & { label: string; title: string };

function MonthsTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = payload?.[0]?.payload as MonthRow | undefined;
  if (!active || !row) return null;
  return (
    <div className="m-0.5 space-y-1 bg-card px-2 py-1.5 pixel-frame-thin">
      <p className="text-xs text-muted-foreground">{row.title}</p>
      {SERIES.map((series) => (
        <p key={series.key} className="flex items-center gap-1.5 text-sm tabular-nums">
          <span aria-hidden className="size-2.5" style={{ background: series.color }} />
          {series.label}: {row[series.key]}
        </p>
      ))}
      {row.spentCents > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">{formatBrl(row.spentCents)}</p>
      )}
    </div>
  );
}

function MonthsChart({ months }: { months: PurchaseMonth[] }) {
  const rows: MonthRow[] = months.map((m) => ({
    ...m,
    label: monthShort.format(monthDate(m.month)).replace(".", ""),
    title: monthLong.format(monthDate(m.month)),
  }));
  const max = Math.max(1, ...months.flatMap((m) => [m.bought, m.finished]));
  const step = max <= 4 ? 1 : max <= 8 ? 2 : 5;
  const ticks = Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);

  return (
    <>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            <span aria-hidden className="size-3" style={{ background: series.color }} />
            {series.label}
          </li>
        ))}
      </ul>
      <ChartContainer className="h-44">
        <BarChart
          data={rows}
          margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
          barGap={2}
          barCategoryGap="20%"
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)", strokeWidth: 2 }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            ticks={ticks}
            domain={[0, ticks.at(-1) ?? 1]}
            allowDecimals={false}
            interval={0}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            isAnimationActive={false}
            content={MonthsTooltip}
          />
          {SERIES.map((series) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              fill={series.color}
              maxBarSize={12}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {/* sr-only numa div: em <table> a altura de 1px e o overflow não valem. */}
      <div className="sr-only">
        <table>
          <caption>Jogos comprados e zerados por mês</caption>
          <thead>
            <tr>
              <th scope="col">Mês</th>
              <th scope="col">Comprados</th>
              <th scope="col">Zerados</th>
              <th scope="col">Gasto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}>
                <th scope="row">{row.title}</th>
                <td>{row.bought}</td>
                <td>{row.finished}</td>
                <td>{formatBrl(row.spentCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
