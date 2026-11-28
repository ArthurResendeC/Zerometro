import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Erro de domínio com status HTTP e código estável (usado pela API e pelas tools do MCP). */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, "not_found", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "conflict", message);
  }
}

/** Já existe um timer rodando em outro jogo (o cliente pode oferecer a troca). */
export class TimerActiveError extends AppError {
  constructor(message: string) {
    super(409, "timer_active", message);
  }
}

/** O nome do jogo bate com mais de um da biblioteca: quem chamou precisa escolher. */
export class AmbiguousGameError extends AppError {
  constructor(
    message: string,
    readonly options: { gameId: number; name: string }[],
  ) {
    super(409, "ambiguous_game", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, "invalid_input", message);
  }
}

/** Tema ou pacote de som que o perfil não tem (ainda não comprou ou ganhou). */
export class ItemNotOwnedError extends AppError {
  constructor(message: string) {
    super(403, "item_not_owned", message);
  }
}

/** Saldo insuficiente para a compra. */
export class InsufficientCoinsError extends AppError {
  constructor(
    readonly price: number,
    readonly balance: number,
  ) {
    super(
      409,
      "insufficient_coins",
      `Faltam ${price - balance} moedas: o item custa ${price} e você tem ${balance}`,
    );
  }
}

export class IgdbError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(502, "igdb_error", message, options);
  }
}

export class IgdbNotConfiguredError extends AppError {
  constructor() {
    super(
      503,
      "igdb_not_configured",
      "IGDB não configurado: defina IGDB_CLIENT_ID e IGDB_CLIENT_SECRET",
    );
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: unknown };
}

/** Steam ou RetroAchievements falhou (rede, HTTP de erro ou resposta inesperada). */
export class AchievementSourceError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(502, "achievements_source_error", message, options);
  }
}

/**
 * A fonte (Steam, RetroAchievements) recusou por excesso de chamadas: a instância para de chamar
 * até `until`, para todos os perfis (ver `rate-gate.ts`).
 */
export class SourceRateLimitedError extends AppError {
  constructor(
    sourceLabel: string,
    readonly until: Date,
  ) {
    const time = until.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const who = sourceLabel.charAt(0).toUpperCase() + sourceLabel.slice(1);
    super(
      503,
      "source_rate_limited",
      `${who} pediu uma pausa nas consultas: tente de novo depois das ${time}`,
    );
  }
}

/** A fonte de conquistas não tem chave configurada nesta instância. */
export class AchievementSourceNotConfiguredError extends AppError {
  constructor(sourceLabel: string, envVar: string) {
    super(
      503,
      "achievements_source_not_configured",
      `${sourceLabel} não configurado: defina ${envVar}`,
    );
  }
}

/** O perfil da Steam não mostra os jogos (privacidade): a mensagem diz o que mudar. */
export class SteamProfilePrivateError extends AppError {
  constructor() {
    super(
      409,
      "steam_profile_private",
      'O perfil da Steam não mostra os jogos. Na Steam, em Editar perfil → Privacidade, deixe "Detalhes dos jogos" como Público',
    );
  }
}

/** Sincronizar sem perfil da Steam ligado. */
export class SteamNotLinkedError extends AppError {
  constructor() {
    super(409, "steam_not_linked", "Conecte seu perfil da Steam nos Ajustes para sincronizar");
  }
}
