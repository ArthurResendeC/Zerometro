import { z } from "zod";
import type { GameStatus } from "./domain";

// Critérios da avaliação guiada (textos, pesos e presets), usados por API, frontend e MCP.
// Base: miniPXI (experiência funcional × psicossocial), GameFlow (social) e os extras do
// Zerômetro (narrativa e parte técnica). Escala de 1 a 7 em cada critério, como o PXI.

export const criterionIds = [
  "controls",
  "goals",
  "feedback",
  "challenge",
  "audiovisual",
  "technical",
  "mastery",
  "curiosity",
  "immersion",
  "autonomy",
  "meaning",
  "narrative",
  "social",
] as const;
export const criterionIdSchema = z.enum(criterionIds);
export type CriterionId = z.infer<typeof criterionIdSchema>;

export const criterionGroups = ["functional", "psychosocial"] as const;
export type CriterionGroup = (typeof criterionGroups)[number];

export const criterionGroupLabels: Record<CriterionGroup, string> = {
  functional: "Como o jogo funciona",
  psychosocial: "Como você se sentiu",
};

/** Escala de cada critério: 1 a 7. */
export const SCORE_MIN = 1;
export const SCORE_MAX = 7;

export interface Criterion {
  id: CriterionId;
  group: CriterionGroup;
  label: string;
  question: string;
  /** O que significa dar 1. */
  low: string;
  /** O que significa dar 7. */
  high: string;
  /** Peso padrão (a soma sem `social` é 100). */
  weight: number;
  /** "Por que isso importa?" (2–3 linhas). */
  why: string;
  example: string;
  /** Começa como "Não se aplica" (o usuário ativa quando faz sentido). */
  optional?: boolean;
}

export const ratingCriteria: readonly Criterion[] = [
  {
    id: "controls",
    group: "functional",
    label: "Controles",
    question: "Os controles respondiam como você queria?",
    low: "Briguei com os controles o jogo todo",
    high: "Nem pensava neles, era extensão das mãos",
    weight: 8,
    why: "Controle é a ponte entre a sua intenção e o que acontece na tela. Quando falha, todo o resto (desafio, imersão) desmorona junto.",
    example:
      "Celeste acerta: cada morte parece culpa sua, não do pulo. Um jogo de câmera teimosa e comando atrasado fica em 2 ou 3.",
  },
  {
    id: "goals",
    group: "functional",
    label: "Objetivos claros",
    question: "Você sabia o que fazer e por quê?",
    low: "Vivia perdido sem saber o próximo passo",
    high: "Sempre soube o que buscar (mesmo explorando livre)",
    weight: 5,
    why: "Objetivo claro não é marcador no mapa: é saber o que você quer alcançar. Mesmo num mundo aberto, a vontade de ir até ali precisa estar clara.",
    example:
      "Breath of the Wild mostra a torre no horizonte e deixa você decidir o caminho. Ficar rodando sem saber para onde ir vale 2.",
  },
  {
    id: "feedback",
    group: "functional",
    label: "Feedback de progresso",
    question: "O jogo mostrava que você estava evoluindo?",
    low: "Parecia que nada mudava",
    high: "Sentia cada avanço (níveis, itens, mapa, habilidades)",
    weight: 5,
    why: "Ver o próprio avanço (mapa se abrindo, habilidade nova, número subindo) é o que transforma horas jogadas em sensação de conquista.",
    example:
      "Hollow Knight faz cada habilidade nova abrir o mapa que você já conhecia. Um grind sem recompensa visível fica em 2 ou 3.",
  },
  {
    id: "challenge",
    group: "functional",
    label: "Desafio",
    question: "A dificuldade estava na medida para você?",
    low: "Chato de fácil ou frustrante de difícil",
    high: "Sempre no limite certo entre fácil e difícil",
    weight: 8,
    why: 'O "flow" acontece quando o desafio acompanha a sua habilidade. Fácil demais vira tédio; difícil demais, frustração. Avalie para você, não para a média.',
    example:
      "Monster Hunter acerta quando cada caçada exige aprender o monstro; um jogo que você passa sem pensar fica em 2 ou 3.",
  },
  {
    id: "audiovisual",
    group: "functional",
    label: "Visual e som",
    question: "A arte, a trilha e os efeitos te agradaram?",
    low: "Feio ou irritante de ouvir",
    high: "Lindo de ver e de ouvir, marcante",
    weight: 8,
    why: "Não é sobre gráfico de ponta: é estilo, direção de arte e som que dão identidade ao jogo e ficam na memória.",
    example:
      "Hades tem arte e trilha que você reconhece em um segundo. Um visual genérico com música que você desliga fica em 3.",
  },
  {
    id: "technical",
    group: "functional",
    label: "Parte técnica",
    question: "Rodou bem, sem bugs e travamentos?",
    low: "Bugs, quedas de FPS ou crashes atrapalharam",
    high: "Liso do começo ao fim",
    weight: 6,
    why: "Desempenho e estabilidade não fazem um jogo bom, mas podem estragar um ótimo. Avalie como rodou para você, na sua plataforma.",
    example:
      "Doom Eternal roda liso até em PC modesto. Um lançamento com crash a cada hora e save corrompido vale 1 ou 2.",
  },
  {
    id: "mastery",
    group: "psychosocial",
    label: "Domínio",
    question: "Você sentiu que ficou bom no jogo?",
    low: "Nunca me senti competente",
    high: "Me senti habilidoso, evoluí de verdade",
    weight: 8,
    why: "Sentir-se competente é uma das necessidades centrais da motivação (teoria da autodeterminação). É a diferença entre o personagem subir de nível e você subir de nível.",
    example:
      "Sekiro: o chefe que parecia impossível vira uma dança. Um jogo em que você vence sem entender como fica em 2 ou 3.",
  },
  {
    id: "curiosity",
    group: "psychosocial",
    label: "Curiosidade",
    question: "O jogo te deixava querendo ver o que vinha depois?",
    low: "Zero vontade de continuar",
    high: '"Só mais uma missão" às 3 da manhã',
    weight: 10,
    why: "A vontade de ver o que vem depois (a próxima área, a próxima carta, o próximo capítulo) é o que faz você voltar ao jogo sem precisar de motivo.",
    example:
      'Balatro e o "só mais uma run". Um jogo que você precisava se forçar a abrir fica em 1 ou 2.',
  },
  {
    id: "immersion",
    group: "psychosocial",
    label: "Imersão",
    question: "Você esquecia o mundo real enquanto jogava?",
    low: "Ficava olhando o relógio",
    high: "Perdia a noção do tempo",
    weight: 12,
    why: "Imersão é estar dentro do jogo: o mundo real some e o tempo voa. É um dos sinais mais fortes de que a experiência funcionou.",
    example:
      "Red Dead Redemption 2 faz você esquecer que está segurando um controle. Ficar conferindo o celular a cada cinco minutos vale 2.",
  },
  {
    id: "autonomy",
    group: "psychosocial",
    label: "Autonomia",
    question: "Você tinha liberdade para jogar do seu jeito?",
    low: "Trilho, sem escolhas",
    high: "Fazia do meu jeito, escolhas importavam",
    weight: 8,
    why: "Autonomia é sentir que as decisões são suas: estilo de jogo, caminho, build. Um jogo linear pode ir bem aqui se as escolhas que oferece pesarem.",
    example:
      "Baldur's Gate 3 deixa resolver quase tudo de três jeitos. Um corredor com uma única solução para cada sala fica em 2.",
  },
  {
    id: "meaning",
    group: "psychosocial",
    label: "Significado",
    question: "O jogo foi importante ou marcante para você?",
    low: "Esqueci logo depois",
    high: "Vou lembrar por anos",
    weight: 10,
    why: "Alguns jogos passam; outros ficam. Significado é o que o jogo deixou em você: um momento, uma ideia, uma fase da vida.",
    example:
      "Outer Wilds muda a forma como você pensa sobre jogos. Um passatempo do qual você não lembra o nome uma semana depois vale 1 ou 2.",
  },
  {
    id: "narrative",
    group: "psychosocial",
    label: "Narrativa",
    question: "A história e os personagens te prenderam?",
    low: "História fraca ou irrelevante",
    high: "História e personagens memoráveis",
    weight: 12,
    why: 'História e personagens dão motivo emocional para seguir. Se o jogo quase não tem história (corrida, puzzle abstrato), use "Não se aplica".',
    example:
      "Clair Obscur: Expedition 33 faz você se importar com cada membro da expedição. Diálogos que você pula sem culpa ficam em 2.",
  },
  {
    id: "social",
    group: "psychosocial",
    label: "Social/coop",
    question: "Jogar com/contra outras pessoas foi bom?",
    low: "Multiplayer ruim ou tóxico",
    high: "As melhores partidas foram com outras pessoas",
    weight: 8,
    why: "Do GameFlow: jogar com outras pessoas pode ser o centro da diversão. Ative só em jogos multiplayer ou coop que você jogou assim.",
    example:
      "It Takes Two só existe a dois. Um online cheio de gente tóxica e matchmaking quebrado fica em 1 ou 2.",
    optional: true,
  },
];

export const criteriaById = Object.fromEntries(ratingCriteria.map((c) => [c.id, c])) as Record<
  CriterionId,
  Criterion
>;

export type CriterionWeights = Record<CriterionId, number>;

/** Os pesos padrão do método. */
export const DEFAULT_WEIGHTS = Object.fromEntries(
  ratingCriteria.map((c) => [c.id, c.weight]),
) as CriterionWeights;

// ---------------------------------------------------------------------------
// Presets por tipo de jogo (multiplicadores sobre os pesos base)

/** `custom` = o usuário mexeu nos pesos da avaliação. */
export const ratingPresets = [
  "default",
  "rpg",
  "platformer",
  "racing_sports",
  "multiplayer",
  "custom",
] as const;
export const ratingPresetSchema = z.enum(ratingPresets);
export type RatingPreset = z.infer<typeof ratingPresetSchema>;

interface PresetDef {
  label: string;
  description: string;
  multipliers: Partial<Record<CriterionId, number>>;
  /** Critérios que começam como "Não se aplica" (além dos opcionais). */
  notApplicable?: CriterionId[];
  /** Critérios opcionais que começam ativos. */
  active?: CriterionId[];
}

export const presetDefs: Record<RatingPreset, PresetDef> = {
  default: { label: "Padrão", description: "Os pesos do método, sem ajustes", multipliers: {} },
  rpg: {
    label: "RPG / aventura narrativa",
    description: "Mais peso para narrativa, significado e imersão",
    multipliers: { narrative: 1.5, meaning: 1.3, immersion: 1.2 },
  },
  platformer: {
    label: "Plataforma / ação",
    description: "Mais peso para controles e desafio; menos para a história",
    multipliers: { controls: 1.5, challenge: 1.3, narrative: 0.5 },
  },
  racing_sports: {
    label: "Corrida / esporte",
    description: "Mais peso para controles e feedback; narrativa começa fora",
    multipliers: { controls: 1.5, feedback: 1.2 },
    notApplicable: ["narrative"],
  },
  multiplayer: {
    label: "Multiplayer / live service",
    description: "Social ativo; mais peso para domínio e autonomia",
    multipliers: { mastery: 1.3, autonomy: 1.2, narrative: 0.5 },
    active: ["social"],
  },
  custom: { label: "Personalizado", description: "Pesos ajustados à mão", multipliers: {} },
};

/** Arredonda pesos a 1 casa (os multiplicadores geram 15.6, 9.6…). */
const roundWeight = (w: number) => Math.round(w * 10) / 10;

/** Pesos de um preset sobre os pesos base (os padrão ou os personalizados do usuário). */
export function presetWeights(
  preset: RatingPreset,
  base: CriterionWeights = DEFAULT_WEIGHTS,
): CriterionWeights {
  const { multipliers } = presetDefs[preset];
  return Object.fromEntries(
    criterionIds.map((id) => [id, roundWeight(base[id] * (multipliers[id] ?? 1))]),
  ) as CriterionWeights;
}

/** Critérios que começam como "Não se aplica" num preset. */
export function presetNotApplicable(preset: RatingPreset): CriterionId[] {
  const { notApplicable = [], active = [] } = presetDefs[preset];
  const optional = ratingCriteria.filter((c) => c.optional && !active.includes(c.id));
  return [...new Set([...optional.map((c) => c.id), ...notApplicable])];
}

// Gêneros e modos do IGDB (nomes originais, em inglês, como o banco guarda).
const RPG_GENRES = new Set(["Role-playing (RPG)", "Adventure", "Visual Novel", "Point-and-click"]);
const ACTION_GENRES = new Set([
  "Platform",
  "Fighting",
  "Shooter",
  "Hack and slash/Beat 'em up",
  "Arcade",
]);
const RACING_GENRES = new Set(["Racing", "Sport"]);
const MULTIPLAYER_GENRES = new Set(["MOBA"]);
const MULTIPLAYER_MODES = new Set(["Massively Multiplayer Online (MMO)", "Battle Royale"]);

/**
 * Preset sugerido pelos gêneros e modos do IGDB (e pelo status "sem fim"). A ordem decide os
 * empates: multiplayer > corrida/esporte > RPG > ação (um RPG de ação fica em RPG).
 */
export function suggestPreset(game: {
  genres: readonly string[];
  gameModes: readonly string[];
  status?: GameStatus | null;
}): Exclude<RatingPreset, "custom"> {
  const hasGenre = (set: Set<string>) => game.genres.some((g) => set.has(g));
  if (
    game.status === "endless" ||
    hasGenre(MULTIPLAYER_GENRES) ||
    game.gameModes.some((m) => MULTIPLAYER_MODES.has(m))
  )
    return "multiplayer";
  if (hasGenre(RACING_GENRES)) return "racing_sports";
  if (hasGenre(RPG_GENRES)) return "rpg";
  if (hasGenre(ACTION_GENRES)) return "platformer";
  return "default";
}
