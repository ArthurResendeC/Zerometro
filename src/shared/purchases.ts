// Comprei × zerei e custo por hora: contrato da seção das Estatísticas e do MCP.
// O preço é dado pessoal: nunca entra no recap nem em nada que se compartilha.

/** Com menos que isso jogado, o custo por hora ainda não diz nada (R$ 200 em 10 minutos). */
export const MIN_MINUTES_FOR_COST = 60;

export interface PurchaseMonth {
  /** YYYY-MM. */
  month: string;
  /** Jogos comprados ou resgatados no mês (pela data da compra). */
  bought: number;
  /** Jogos zerados pela primeira vez no mês (replays não diminuem a pilha). */
  finished: number;
  spentCents: number;
}

export interface PurchaseGame {
  gameId: number;
  /** Id no IGDB: é por ele que a página do jogo é aberta. */
  igdbId: number;
  name: string;
  coverImageId: string | null;
  acquiredOn: string | null;
  pricePaidCents: number | null;
  store: string | null;
  minutesPlayed: number;
}

export interface CostPerHourGame extends PurchaseGame {
  pricePaidCents: number;
  centsPerHour: number;
}

export interface PurchaseStats {
  from: string;
  to: string;
  year: number | null;
  /** Algum jogo da biblioteca tem compra informada (sem isso, a tela explica como começar). */
  hasPurchases: boolean;
  /** No período, pela data da compra. */
  bought: number;
  /** Quantos dos comprados vieram de assinatura. */
  viaSubscription: number;
  spentCents: number;
  /** Jogos zerados pela primeira vez no período. */
  finished: number;
  /** Do primeiro ao último mês do período (até hoje). */
  byMonth: PurchaseMonth[];
  /**
   * Todas as compras com preço (de qualquer data, fora as de assinatura e as de graça) e com
   * pelo menos `MIN_MINUTES_FOR_COST` jogados, da mais barata por hora para a mais cara.
   */
  costPerHour: CostPerHourGame[];
  /** Soma dos preços ÷ soma das horas dos jogos de `costPerHour` (null sem nenhum). */
  averageCentsPerHour: number | null;
  /** Comprados (não por assinatura), de qualquer data, ainda sem tempo jogado nem conclusão. */
  unplayed: PurchaseGame[];
  unplayedCents: number;
}
