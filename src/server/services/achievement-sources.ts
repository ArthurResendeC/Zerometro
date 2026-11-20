import type { AchievementSource } from "../../shared/achievements";

// Formato comum do que os clientes da Steam e do RetroAchievements devolvem: a lista de
// conquistas de um jogo na fonte, pronta para gravar em `achievement_sets`/`achievements`.

export interface FetchedAchievement {
  /** apiname na Steam; id numérico (em texto) no RA. */
  externalId: string;
  title: string;
  description: string | null;
  iconUrl: string | null;
  /** Ícone cinza (ainda não desbloqueada). */
  iconLockedUrl: string | null;
  /** % global de quem desbloqueou (0..100). */
  rarity: number | null;
  /** Pontos (só RA). */
  points: number | null;
  /** Conquista secreta: a interface esconde até pedir para ver. */
  hidden: boolean;
  sortOrder: number;
}

export interface FetchedAchievementSet {
  source: AchievementSource;
  /** appid na Steam; id do jogo no RA. */
  externalId: string;
  /** Nome do jogo na fonte (null quando a fonte não dá um nome confiável). */
  title: string | null;
  /** Console no RA (null na Steam). */
  platform: string | null;
  achievements: FetchedAchievement[];
}

/** Um cliente de fonte: `enabled` falso = sem chave, a interface esconde a fonte. */
export interface AchievementSourceApi {
  readonly enabled: boolean;
  /** A lista de conquistas do jogo na fonte; null se o jogo não existir ou não tiver conquistas. */
  getAchievementSet(externalId: number): Promise<FetchedAchievementSet | null>;
}
