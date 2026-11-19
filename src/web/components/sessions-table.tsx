import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
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
};

const features = tableFeatures({});
const column = createColumnHelper<typeof features, PlaySessionItem>();

// `column.columns` preserva os tipos de valor de cada coluna (API da v9).
const columns = column.columns([
  column.accessor("playedOn", {
    header: "Dia",
    cell: (info) => <span className="whitespace-nowrap">{formatDate(info.getValue())}</span>,
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
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} className="px-3 py-2 font-medium">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
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
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Editar sessão"
        onClick={() => openEdit(session)}
      >
        <Pencil />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label="Apagar sessão"
          >
            <Trash2 />
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
