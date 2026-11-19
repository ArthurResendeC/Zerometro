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

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, "invalid_input", message);
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
