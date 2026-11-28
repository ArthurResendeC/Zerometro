import { z } from "zod";

// O que cada um deixa os amigos verem no /amigo dele, seção por seção. Fica nos ajustes de
// quem é visto; o servidor só manda para os amigos o que estiver ligado.

export const groupSections = [
  // Resumo
  "totals",
  "playing",
  "finished",
  "ratings",
  // Estatísticas
  "heatmap",
  "breakdown",
  "timeline",
  "rhythm",
  "records",
  "purchases",
  // Perfil de gamer
  "criteria",
  "developers",
  "publishers",
  "series",
  "franchises",
  "genres",
  "themes",
  "perspectives",
  "gameModes",
  "platforms",
] as const;
export type GroupSection = (typeof groupSections)[number];

/** Só o que mudou do padrão fica guardado: seção nova entra com o padrão dela. */
export const groupSectionsSchema = z.partialRecord(z.enum(groupSections), z.boolean());
export type GroupSectionsSetting = z.infer<typeof groupSectionsSchema>;

/** Tudo ligado, menos o que mostra dinheiro. */
const hiddenByDefault: ReadonlySet<GroupSection> = new Set(["purchases"]);

export function isSectionShared(setting: GroupSectionsSetting, section: GroupSection): boolean {
  return setting[section] ?? !hiddenByDefault.has(section);
}

export function sharedSections(setting: GroupSectionsSetting): GroupSection[] {
  return groupSections.filter((section) => isSectionShared(setting, section));
}

export const groupTabs = ["summary", "stats", "profile"] as const;
export type GroupTab = (typeof groupTabs)[number];

export const groupTabLabels: Record<GroupTab, string> = {
  summary: "Resumo",
  stats: "Estatísticas",
  profile: "Perfil de gamer",
};

export interface GroupSectionInfo {
  section: GroupSection;
  label: string;
  /** O que mais a seção revela, quando não é óbvio pelo nome. */
  hint?: string;
}

/** As seções de cada aba, na ordem da tela (e dos ajustes). */
export const groupSectionsByTab: Record<GroupTab, GroupSectionInfo[]> = {
  summary: [
    { section: "totals", label: "Totais", hint: "Horas, zerados, 100%, conquistas e biblioteca" },
    { section: "playing", label: "Jogando" },
    { section: "finished", label: "Zerou por último" },
    { section: "ratings", label: "Notas", hint: "A nota de cada jogo, em todo lugar do grupo" },
  ],
  stats: [
    { section: "heatmap", label: "Atividade", hint: "Quanto jogou em cada dia" },
    { section: "breakdown", label: "Gêneros e jogos mais jogados" },
    { section: "timeline", label: "Linha do tempo" },
    { section: "rhythm", label: "Ritmo", hint: "Dias da semana e horários" },
    { section: "records", label: "Recordes e zerados" },
    {
      section: "purchases",
      label: "Comprei × zerei",
      hint: "Mostra quanto gastou e o custo por hora",
    },
  ],
  profile: [
    {
      section: "criteria",
      label: "O que mais valoriza",
      hint: "A média dos critérios da avaliação",
    },
    { section: "developers", label: "Desenvolvedoras" },
    { section: "publishers", label: "Publishers" },
    { section: "series", label: "Séries" },
    { section: "franchises", label: "Franquias" },
    { section: "genres", label: "Gêneros" },
    { section: "themes", label: "Temas" },
    { section: "perspectives", label: "Perspectiva" },
    { section: "gameModes", label: "Modos de jogo" },
    { section: "platforms", label: "Plataformas" },
  ],
};

export const tabOfSection = Object.fromEntries(
  groupTabs.flatMap((tab) => groupSectionsByTab[tab].map(({ section }) => [section, tab])),
) as Record<GroupSection, GroupTab>;
