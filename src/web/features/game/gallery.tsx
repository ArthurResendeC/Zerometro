import { useState } from "react";
import { coverUrl } from "@shared/igdb";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// Screenshots do IGDB: grade de miniaturas; o clique abre a imagem grande, com setas
// (na tela e no teclado) para passar.

export function Gallery({ imageIds, gameName }: { imageIds: string[]; gameName: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = imageIds.length;
  const go = (delta: number) => setOpen((i) => (i === null ? i : (i + delta + count) % count));
  const current = open === null ? undefined : imageIds[open];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {imageIds.map((id, i) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="group m-0.5 block w-[calc(100%-4px)] cursor-pointer pixel-frame-thin hover:[--px-frame-color:var(--primary)]"
              aria-label={`Ampliar imagem ${i + 1} de ${count}`}
            >
              <img
                src={coverUrl(id, "screenshot_med")}
                alt=""
                loading="lazy"
                className="aspect-video w-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent
          className="gap-3 p-3 sm:max-w-5xl"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
        >
          <DialogTitle className="sr-only">Imagens de {gameName}</DialogTitle>
          <DialogDescription className="sr-only">
            Use as setas para passar as imagens.
          </DialogDescription>
          {current && (
            <img
              key={current}
              src={coverUrl(current, "1080p")}
              alt={`Imagem ${(open ?? 0) + 1} de ${count} de ${gameName}`}
              className="aspect-video w-full bg-black object-contain"
            />
          )}
          {count > 1 && (
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => go(-1)}>
                <ArrowLeftIcon /> Anterior
              </Button>
              <span className="display-xs text-muted-foreground tabular-nums">
                {(open ?? 0) + 1} / {count}
              </span>
              <Button variant="outline" size="sm" onClick={() => go(1)}>
                Próxima <ArrowRightIcon />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
