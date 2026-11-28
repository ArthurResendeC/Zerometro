import { ListIcon, TimerIcon, TrophyIcon } from "@/components/icons";
import { type SegmentedOption, SegmentedToggle } from "@/components/segmented-toggle";

export const gameTabs = ["sobre", "sessoes", "conquistas"] as const;
export type GameTab = (typeof gameTabs)[number];

const tabOptions: SegmentedOption<GameTab>[] = [
  { value: "sobre", label: "Sobre o jogo", short: "Sobre", Icon: ListIcon },
  { value: "sessoes", label: "Minhas sessões", short: "Sessões", Icon: TimerIcon },
  { value: "conquistas", label: "Conquistas", short: "Conquistas", Icon: TrophyIcon },
];

/** Subtelas de "Minhas sessões": o dia a dia primeiro; os detalhes, que mudam pouco, à parte. */
export const sessionSections = ["progresso", "sessoes", "detalhes"] as const;
export type SessionSection = (typeof sessionSections)[number];

/** Alternância das abas da página do jogo. */
export function TabToggle({ tab, onChange }: { tab: GameTab; onChange: (tab: GameTab) => void }) {
  return <SegmentedToggle legend="Ver" options={tabOptions} value={tab} onChange={onChange} />;
}
