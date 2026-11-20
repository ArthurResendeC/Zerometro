import type { ComponentType } from "react";
import { ListIcon, TimerIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export const gameTabs = ["sobre", "sessoes"] as const;
export type GameTab = (typeof gameTabs)[number];

const tabInfo: Record<GameTab, { label: string; short: string; Icon: ComponentType }> = {
  sobre: { label: "Sobre o jogo", short: "Sobre", Icon: ListIcon },
  sessoes: { label: "Minhas sessões", short: "Sessões", Icon: TimerIcon },
};

/** Alternância das abas da página do jogo: dois botões colados numa moldura só. */
export function TabToggle({ tab, onChange }: { tab: GameTab; onChange: (tab: GameTab) => void }) {
  return (
    <fieldset className="mt-1 mr-3 mb-3 ml-1 inline-flex bg-background pixel-frame pixel-frame-ink pixel-drop">
      <legend className="sr-only">Ver</legend>
      {gameTabs.map((t) => {
        const { label, short, Icon } = tabInfo[t];
        const active = t === tab;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t)}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-2 px-3 display-xs [&_svg]:size-3",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon />
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
