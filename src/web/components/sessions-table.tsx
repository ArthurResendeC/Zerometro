import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { DEFAULT_TIME_ZONE, zonedParts } from "@shared/dates";
import type { PlaySessionItem } from "@shared/sessions";
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
import { PencilIcon, TrashIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatMinutes } from "@/lib/format";
import { sessionsQuery, useDeleteSession } from "@/lib/queries";
import { useLogSessionDialog } from "@/stores/log-session-dialog";

const SOURCE_LABELS: Record<PlaySessionItem["source"], string | null> = {
  manual: null,
  timer: null,
  mcp: "IA",
  steam: "Steam",
};

const localTime = (iso: string) => zonedParts(new Date(iso), DEFAULT_TIME_ZONE).time;

const features = tableFeatures({});
const column = createColumnHelper<typeof features, PlaySessionItem>();

// `column.columns` preserva os tipos de valor de cada coluna (API da v9).
const columns = column.columns([
  column.accessor("playedOn", {
    header: "Dia",
    cell: (info) => {
      const { startedAt, endedAt } = info.row.original;
      return (
        <span className="flex flex-col whitespace-nowrap">
          {formatDate(info.getValue())}
          {startedAt && endedAt && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {localTime(startedAt)}–{localTime(endedAt)}
            </span>
          )}
        </span>
      );
    },
  }),
  column.accessor("minutes", {
    header: "Duração",
    cell: (info) => <span className="tabular-nums">{formatMinutes(info.getValue())}</span>,
  }),
  column.accessor("note", {
    header: "Nota",
    cell: (info) => {
      const source = SOURCE_LABELS[info.row.original.source];
      return (
        <span className="flex items-center gap-2 text-muted-foreground">
          {source && <Badge variant="outline">{source}</Badge>}
          <span className="line-clamp-2">{info.getValue()}</span>
        </span>
      );
    },
  }),
  column.display({
    id: "actions",
    header: () => <span className="sr-only">Ações</span>,
    cell: (info) => <RowActions session={info.row.original} />,
  }),
]);

/** Histórico de sessões de um jogo (TanStack Table). */
export function SessionsTable({ gameId }: { gameId: number }) {
  const { data, isPending } = useQuery(sessionsQuery({ gameId }));
  const table = useTable({ features, columns, data: data ?? [] });

  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">Nenhuma sessão registrada ainda.</p>;
  }

  return (
    <div className="relative m-1 overflow-x-auto bg-card pixel-frame">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-left text-muted-foreground">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} className="px-3 py-3 display-xs font-normal whitespace-nowrap">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t-2 border-dashed border-muted hover:bg-accent">
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2 align-middle">
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({ session }: { session: PlaySessionItem }) {
  const openEdit = useLogSessionDialog((s) => s.openEdit);
  const remove = useDeleteSession();

  return (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon"
        className="size-9"
        aria-label={`Editar sessão de ${formatDate(session.playedOn)}`}
        onClick={() => openEdit(session)}
      >
        <PencilIcon />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground hover:text-destructive"
            aria-label={`Apagar sessão de ${formatDate(session.playedOn)}`}
          >
            <TrashIcon />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar sessão?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatMinutes(session.minutes)} em {formatDate(session.playedOn)}. Não dá para
              desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate(session.id)}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
