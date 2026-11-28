// Economia de moedas: as regras de ganho, iguais para servidor (que lança no livro-razão) e
// interface (que explica como ganhar). Ajustar um número aqui e recalcular a carteira
// (`reconcileWallet`) lança a diferença como ajuste; nada é apagado.

/** Por que entrou ou saiu moeda. */
export const coinReasons = ["playtime", "achievement", "purchase", "grant"] as const;
export type CoinReason = (typeof coinReasons)[number];

/** Motivos calculados a partir dos dados (sessões, conquistas): recalculáveis a qualquer hora. */
export const derivedReasons = ["playtime", "achievement"] as const satisfies readonly CoinReason[];

// ---------------------------------------------------------------------------------------------
// Horas jogadas

/** Moedas por hora jogada. */
export const COINS_PER_HOUR = 10;
/** Teto de minutos que rendem moedas num dia (somando todos os jogos). */
export const DAILY_PLAYTIME_CAP_MINUTES = 6 * 60;

/** Moedas de um dia com `minutes` jogados (todas as fontes de sessão; o "antes do Zerômetro" não é sessão). */
export function playtimeCoins(minutes: number): number {
  const counted = Math.min(Math.max(minutes, 0), DAILY_PLAYTIME_CAP_MINUTES);
  return Math.floor((counted * COINS_PER_HOUR) / 60);
}

// ---------------------------------------------------------------------------------------------
// Conquistas (só as da Steam vindas da sincronização: dá para comprovar)

/** Faixas de raridade (% global de quem desbloqueou), da mais rara para a mais comum. */
export const achievementTiers = [
  { maxRarity: 5, coins: 50, label: "Ultra rara (até 5%)" },
  { maxRarity: 10, coins: 30, label: "Muito rara (até 10%)" },
  { maxRarity: 25, coins: 15, label: "Rara (até 25%)" },
  { maxRarity: 50, coins: 10, label: "Incomum (até 50%)" },
  { maxRarity: 100, coins: 5, label: "Comum" },
] as const;

/** Moedas de uma conquista pela raridade; sem raridade conhecida, vale como comum. */
export function achievementCoins(rarity: number | null): number {
  if (rarity === null || !Number.isFinite(rarity)) return 5;
  return (achievementTiers.find((tier) => rarity <= tier.maxRarity) ?? achievementTiers.at(-1)!)
    .coins;
}

// ---------------------------------------------------------------------------------------------
// Carteira (o que a API devolve)

/** Detalhes de um lançamento, para a interface descrever ("2h de jogo em 27/11"). */
export interface CoinEntryDetails {
  /** playtime: o dia (YYYY-MM-DD) e o total de minutos do dia quando lançou. */
  day?: string;
  minutes?: number;
  /** achievement: título, jogo e raridade. */
  title?: string;
  game?: string | null;
  rarity?: number | null;
  /** Ajuste de um lançamento anterior (sessão editada/apagada, regra mudou). */
  adjustment?: boolean;
}

export interface CoinEntry {
  id: number;
  amount: number;
  reason: CoinReason;
  details: CoinEntryDetails;
  createdAt: string;
}

export interface Wallet {
  balance: number;
  /** Total ganho (só entradas positivas de horas e conquistas, menos ajustes). */
  earned: { playtime: number; achievement: number };
  /** Desde quando rende (o cadastro), YYYY-MM-DD no fuso do usuário. */
  since: string;
  entries: CoinEntry[];
}

export const WALLET_PAGE_SIZE = 50;
