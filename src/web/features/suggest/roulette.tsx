import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Suggestion } from "@shared/suggest";
import { GameCover } from "@/components/game-cover";
import { useSound } from "@/features/audio/use-sound";

// Roleta 8 bits: uma faixa de capas que corre e desacelera até parar no jogo sorteado, com um
// tique a cada capa que passa pelo marcador. Com "reduzir movimento", mostra o resultado direto.

/** Largura de uma capa + o espaço entre elas (px): w-16 + gap-2. */
const SLOT = 72;
/** Voltas completas antes de parar. */
const LOOPS = 5;
const DURATION_S = 3.2;

interface RouletteProps {
  pool: Suggestion[];
  picked: Suggestion;
  onDone: () => void;
}

export function Roulette({ pool, picked, onDone }: RouletteProps) {
  const reduceMotion = useReducedMotion();
  const { play } = useSound();
  const x = useMotionValue(0);
  // A faixa: o pool repetido; o alvo é o sorteado na volta LOOPS, com mais uma volta depois
  // para a faixa não acabar à direita do marcador.
  const strip = Array.from({ length: LOOPS + 2 }, (_, loop) =>
    pool.map((suggestion) => ({ key: `${loop}:${suggestion.item.gameId}`, suggestion })),
  ).flat();
  const target = LOOPS * pool.length + pool.indexOf(picked);
  // O onDone pode mudar a cada render do pai: a animação usa sempre o último.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (reduceMotion) {
      play("roulette-win");
      done.current();
      return;
    }
    let lastSlot = 0;
    const controls = animate(x, -target * SLOT, {
      duration: DURATION_S,
      // Arranca rápido e freia devagar, como uma roleta de verdade.
      ease: [0.15, 0.85, 0.25, 1],
      onUpdate: (value) => {
        const slot = Math.round(-value / SLOT);
        if (slot !== lastSlot) {
          lastSlot = slot;
          play("roulette-tick");
        }
      },
      onComplete: () => {
        play("roulette-win");
        done.current();
      },
    });
    return () => controls.stop();
    // Uma animação por sorteio (o pai troca a `key` para sortear de novo).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Só visual: o resultado aparece logo abaixo, em texto, quando a roleta para.
    <div className="relative h-28 overflow-hidden bg-background pixel-frame" aria-hidden>
      {/* O marcador no meio. */}
      <div
        className="absolute inset-y-0 left-1/2 z-10 w-[68px] -translate-x-1/2 border-4 border-primary"
        aria-hidden
      />
      <motion.ul
        className="absolute top-2 left-1/2 flex gap-2"
        // A capa 0 começa centralizada: cada SLOT de x anda uma capa.
        style={{ x, marginLeft: -32 }}
      >
        {strip.map(({ key, suggestion }) => (
          <li key={key} className="w-16 shrink-0">
            <GameCover
              name={suggestion.item.name}
              imageId={suggestion.item.coverImageId}
              size="cover_small"
            />
          </li>
        ))}
      </motion.ul>
    </div>
  );
}
