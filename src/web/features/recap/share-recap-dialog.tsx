import { useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { type Recap, type RecapImageFormat, recapImageFileName } from "@shared/recap";
import type { RecapSlideId } from "@shared/recap-slides";
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
import { slideTitles } from "./recap-slides";

// Imagem do recap para compartilhar: o servidor gera o PNG (o recap geral em stories ou paisagem,
// ou um slide só, em stories), a prévia mostra exatamente o arquivo que vai sair, e o botão usa a
// folha de compartilhar do celular (Web Share com arquivo) ou baixa o arquivo quando ela não
// existe (desktop).

const formats: { value: RecapImageFormat; label: string; hint: string }[] = [
  { value: "story", label: "Stories", hint: "9:16" },
  { value: "wide", label: "Paisagem", hint: "16:9" },
];

/**
 * O PNG do recap. Fora da chave "stats" de propósito: tudo sob ela vai para o cache offline
 * (IndexedDB), e um File não é JSON. A URL de objeto vive enquanto a página estiver aberta.
 */
function recapImageQuery(recap: Recap, format: RecapImageFormat, slide?: RecapSlideId) {
  return queryOptions({
    queryKey: ["recap-image", recap.period, recap.from, slide ?? format],
    queryFn: async ({ signal }) => {
      const href = api.stats.recap.image.$path({
        query: { period: recap.period, date: recap.from, ...(slide ? { slide } : { format }) },
      });
      const res = await fetch(href, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const name = recapImageFileName(recap, slide ?? format);
      const file = new File([await res.blob()], name, { type: "image/png" });
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

/** Sem `slide`, o recap geral (com escolha de formato); com ele, só aquele slide, em stories. */
export function ShareRecapDialog({
  recap,
  slide,
  open,
  onOpenChange,
}: {
  recap: Recap;
  slide?: RecapSlideId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [chosenFormat, setFormat] = useState<RecapImageFormat>("story");
  const format = slide ? "story" : chosenFormat;
  const image = useQuery({ ...recapImageQuery(recap, format, slide), enabled: open });
  const shareable = image.data !== undefined && canShareFile(image.data.file);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{slide ? `Slide: ${slideTitles[slide]}` : "Compartilhar recap"}</DialogTitle>
          <DialogDescription>
            {slide
              ? "Este slide como imagem, no formato dos stories."
              : "Uma imagem com o resumo, para os stories ou para posts e conversas."}
          </DialogDescription>
        </DialogHeader>

        {!slide && (
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
        )}

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
              alt={
                slide
                  ? `Prévia da imagem do slide ${slideTitles[slide]}`
                  : "Prévia da imagem do recap"
              }
              className="size-full object-contain frame-ring"
            />
          )}
          {image.isPending && (
            <p className="animate-blink font-pixel text-(length:--display-xs) text-muted-foreground">
              Gerando…
            </p>
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
