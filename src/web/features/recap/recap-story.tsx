import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Recap } from "@shared/recap";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RecapSlide, slideThemes, slideTitles } from "./recap-slides";
import { ShareRecapDialog } from "./share-recap-dialog";
import { type RecapSlideId, recapSlides } from "@shared/recap-slides";

// Slides no estilo stories: barras de progresso no topo, toque à esquerda volta e à direita
// avança, segurar pausa. Cada slide dura o tempo da animação `recap-fill` (8s) e o fim dela
// avança. Com movimento reduzido, a animação não roda (styles.css), então nada avança sozinho.
// O botão de imagem embaixo gera a imagem só do slide atual (o do topo da página é o recap geral).

/** Toque mais curto que isso navega; mais longo só pausou. */
const TAP_MS = 300;

export function RecapStory({ recap }: { recap: Recap }) {
  const slides = useMemo(() => recapSlides(recap), [recap]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  /** Slide aberto no diálogo de imagem; enquanto ele está aberto, o story fica parado. */
  const [sharing, setSharing] = useState<RecapSlideId | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const press = useRef<number | null>(null);
  const last = slides.length - 1;
  const current = slides[Math.min(index, last)]!;

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), last)),
    [last],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea")) {
        return;
      }
      // Diálogo aberto (ex.: compartilhar): as teclas são dele.
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        setPaused((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const running = !paused && !held && !shareOpen;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center px-4 pt-3 pb-4">
      {/* A moldura cabe no espaço que sobra (largura e altura), com folga para a sombra. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]">
        <section
          aria-roledescription="carrossel"
          aria-label="Recap"
          className={cn(
            "relative aspect-9/16 w-[min(calc(100cqw-16px),calc((100cqh-16px)*9/16),440px)] touch-manipulation overflow-hidden select-none pixel-frame pixel-frame-ink pixel-drop",
            slideThemes[current],
          )}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            press.current = e.timeStamp;
            setHeld(true);
          }}
          onPointerUp={(e) => {
            setHeld(false);
            const started = press.current;
            press.current = null;
            if (started === null || e.timeStamp - started > TAP_MS) return;
            const rect = e.currentTarget.getBoundingClientRect();
            go(e.clientX < rect.left + rect.width / 3 ? -1 : 1);
          }}
          onPointerLeave={() => {
            press.current = null;
            setHeld(false);
          }}
          onPointerCancel={() => {
            press.current = null;
            setHeld(false);
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-scanlines opacity-25"
          />

          <div className="absolute inset-x-4 top-4 z-10 flex gap-1.5" aria-hidden>
            {slides.map((id, i) => (
              <div key={id} className="h-1 flex-1 bg-current/25">
                {i === index ? (
                  <div
                    key={`${id}-current`}
                    className="h-full w-full animate-recap-fill bg-current"
                    style={{ animationPlayState: running ? "running" : "paused" }}
                    onAnimationEnd={() => go(1)}
                  />
                ) : (
                  <div className={cn("h-full bg-current", i < index ? "w-full" : "w-0")} />
                )}
              </div>
            ))}
          </div>

          <div
            key={current}
            aria-live="polite"
            className="relative flex h-full flex-col px-5 pt-11 pb-6 duration-300 animate-in fade-in"
          >
            <RecapSlide id={current} recap={recap} />
          </div>
        </section>
      </div>

      <div className="mt-3 flex w-full max-w-[440px] items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Slide anterior"
          disabled={index === 0}
          onClick={() => go(-1)}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Button
            variant="ghost"
            size="icon"
            aria-label={paused ? "Continuar" : "Pausar"}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
          <span className="tabular-nums">
            <span className="max-sm:hidden">{slideTitles[current]} · </span>
            {index + 1}/{slides.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Imagem do slide ${slideTitles[current]}`}
            title="Imagem deste slide"
            onClick={() => {
              setSharing(current);
              setShareOpen(true);
            }}
          >
            <DownloadIcon />
          </Button>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Próximo slide"
          disabled={index === last}
          onClick={() => go(1)}
        >
          <ArrowRightIcon />
        </Button>
      </div>

      {/* O slide fica guardado ao fechar, para a animação de saída não trocar a prévia. */}
      {sharing && (
        <ShareRecapDialog
          recap={recap}
          slide={sharing}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </div>
  );
}
