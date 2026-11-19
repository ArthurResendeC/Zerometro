import { hc, type ClientResponse } from "hono/client";
import type { SuccessStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody } from "@server/errors";
import type { AppType } from "@server/app";

// Cliente RPC tipado de ponta a ponta: api.health.$get(), api.library.$get(), etc.
export const { api } = hc<AppType>("/");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type SuccessBody<R> =
  R extends ClientResponse<infer Body, infer Status, string>
    ? Status extends SuccessStatusCode
      ? Body
      : never
    : never;

/** Aguarda a resposta e devolve o corpo de sucesso, ou lança ApiError com a mensagem da API. */
export async function unwrap<R extends ClientResponse<unknown, number, string>>(
  request: Promise<R>,
): Promise<SuccessBody<R>> {
  const res = await request;
  if (res.ok) return (await res.json()) as SuccessBody<R>;

  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // corpo não-JSON (ex.: proxy fora do ar)
  }
  throw new ApiError(
    res.status,
    body.error?.code ?? "http_error",
    body.error?.message ?? `Erro ${res.status}`,
  );
}
