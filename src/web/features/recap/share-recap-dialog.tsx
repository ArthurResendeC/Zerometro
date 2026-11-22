import { useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { Recap, RecapImageFormat } from "@shared/recap";
import { DownloadIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Imagem do recap para compartilhar: o servidor gera o PNG (stories ou paisagem), a prévia
// mostra exatamente o arquivo que vai sair, e o botão usa a folha de compartilhar do celular
// (Web Share com arquivo) ou baixa o arquivo quando ela não existe (desktop).

const formats: { value: RecapImageFormat; label: string; hint: string }[] = [
  { value: "story", label: "Stories", hint: "9:16" },
  { value: "wide", label: "Paisagem", hint: "16:9" },
];

function fileName(recap: Recap, format: RecapImageFormat): string {
  const period = recap.period === "week" ? "semana" : "mes";
  return `zerometro-recap-${period}-${recap.from}-${format}.png`;
}

/**
 * O PNG do recap. Fora da chave "stats" de propósito: tudo sob ela vai para o cache offline
 * (IndexedDB), e um File não é JSON. A URL de objeto vive enquanto a página estiver aberta.
 */
function recapImageQuery(recap: Recap, format: RecapImageFormat) {
  return queryOptions({
    queryKey: ["recap-image", recap.period, recap.from, format],
    queryFn: async ({ signal }) => {
      const href = api.stats.recap.image.$path({
        query: { period: recap.period, date: recap.from, format },
      });
      const res = await fetch(href, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = new File([await res.blob()], fileName(recap, format), { type: "image/png" });
      return { file, url: URL.createObjectURL(file) };
    },
    staleTime: 60_000,
    retry: 1,
  });
}

async function share(file: File) {
  try {
    await navigator.share({ files: [file] });
  } catch {
    // Cancelado na folha de compartilhar: nada a fazer.
  }
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function ShareRecapDialog({
  recap,
  open,
  onOpenChange,
}: {
  recap: Recap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [format, setFormat] = useState<RecapImageFormat>("story");
  const image = useQuery({ ...recapImageQuery(recap, format), enabled: open });
  const shareable = image.data !== undefined && canShareFile(image.data.file);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compartilhar recap</DialogTitle>
          <DialogDescription>
            Uma imagem com o resumo, para os stories ou para posts e conversas.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">Formato</legend>
          {formats.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={f.value === format ? "default" : "outline"}
              aria-pressed={f.value === format}
              onClick={() => setFormat(f.value)}
            >
              {f.label} <span className="opacity-70 max-sm:hidden">{f.hint}</span>
            </Button>
          ))}
        </fieldset>

        <div
          className={cn(
            "mx-auto flex items-center justify-center bg-muted",
            format === "story"
              ? "aspect-9/16 h-[min(52dvh,480px)]"
              : "aspect-video w-full max-w-[520px]",
          )}
        >
          {image.data && (
            <img
              src={image.data.url}
              alt="Prévia da imagem do recap"
              className="size-full object-contain shadow-[0_0_0_2px_var(--pixel-shadow)]"
            />
          )}
          {image.isPending && (
            <p className="animate-blink font-pixel text-[10px] text-muted-foreground">Gerando…</p>
          )}
          {image.isError && !image.data && (
            <p className="p-4 text-center text-muted-foreground">
              Não deu para gerar a imagem. Ela é feita no servidor: confira a conexão e tente de
              novo.
            </p>
          )}
        </div>

        <DialogFooter>
          {image.data && (
            <Button asChild variant={shareable ? "outline" : "default"}>
              <a href={image.data.url} download={image.data.file.name}>
                <DownloadIcon />
                Baixar
              </a>
            </Button>
          )}
          {shareable && image.data && (
            <Button onClick={() => void share(image.data.file)}>
              <UploadIcon />
              Compartilhar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
