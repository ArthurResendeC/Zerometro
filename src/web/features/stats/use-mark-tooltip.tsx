import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// Balão das marcas de um gráfico feito à mão (dias do heatmap, barras da linha do tempo).
// Com mouse a marca aparece no hover; no toque, tocar numa marca fixa o balão até o próximo
// toque (em outra marca troca, na mesma ou fora das marcas fecha), como um menu.

const MARK_ATTR = "data-tooltip-mark";

interface ActiveMark<T> {
  key: string;
  item: T;
  /** Centro do topo da marca, na viewport. */
  x: number;
  y: number;
  /** Fixado pelo toque: fica até o próximo toque. Sem isso, é hover do mouse. */
  pinned: boolean;
}

export function useMarkTooltip<T>() {
  const [active, setActive] = useState<ActiveMark<T> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // O balão é `fixed`: qualquer rolagem (do gráfico ou da página) o descola da marca, então fecha.
  // Fixado pelo toque, também fecha com um toque fora das marcas ou com Esc.
  const pinned = active?.pinned ?? false;
  useEffect(() => {
    if (!active) return;
    const close = () => setActive(null);
    const onPointerDown = (event: PointerEvent) => {
      // Tocar numa marca é tratado no pointerup dela (troca ou fecha); qualquer outro lugar fecha.
      if (!(event.target as Element).closest?.(`[${MARK_ATTR}]`)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    if (pinned) {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    }
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, pinned]);

  // Centralizado na marca, mas sem passar da borda da tela.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el || !active) return;
    const margin = 8;
    const half = el.offsetWidth / 2;
    const max = document.documentElement.clientWidth - margin - half;
    el.style.left = `${Math.max(margin + half, Math.min(active.x, max))}px`;
  }, [active]);

  const show = (target: Element, key: string, item: T, isPinned: boolean) => {
    const rect = target.getBoundingClientRect();
    setActive({ key, item, x: rect.left + rect.width / 2, y: rect.top, pinned: isPinned });
  };

  return {
    active,
    /** Props de uma marca. */
    mark: (key: string, item: T) => ({
      [MARK_ATTR]: "",
      onPointerEnter: (event: ReactPointerEvent<Element>) => {
        // No toque o pointerenter vem junto do tap; quem decide é o pointerup.
        if (event.pointerType !== "mouse" || active?.pinned) return;
        show(event.currentTarget, key, item, false);
      },
      onPointerUp: (event: ReactPointerEvent<Element>) => {
        // Com mouse o hover já basta. No toque, arrastar para rolar vira pointercancel, então
        // só um tap de verdade chega aqui.
        if (event.pointerType === "mouse") return;
        if (active?.pinned && active.key === key) setActive(null);
        else show(event.currentTarget, key, item, true);
      },
    }),
    /** No contêiner das marcas: o hover do mouse acaba ao sair dele. */
    onPointerLeave: (event: ReactPointerEvent) => {
      if (event.pointerType === "mouse") setActive((prev) => (prev?.pinned ? prev : null));
    },
    /** A marca fixada pelo toque (para destacá-la). */
    isPinned: (key: string) => Boolean(active?.pinned && active.key === key),
    tooltip: (content: (item: T) => ReactNode) =>
      active && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-full pb-1"
          style={{ left: active.x, top: active.y }}
        >
          {content(active.item)}
        </div>
      ),
  };
}
