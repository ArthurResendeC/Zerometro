// O que o servidor de autorização entrega, assinado em vez de guardado: um redeploy não
// desconecta ninguém e não há tabela para limpar. O client_id carrega o que o cliente registrou;
// access e refresh tokens carregam a concessão. Trocar o ZEROMETRO_TOKEN (de onde sai a chave)
// revoga todos de uma vez.
//
// Portado do my-scratchpad (https://github.com/Levieber/my-scratchpad, src/mcp/oauth/, MIT).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPE = "zerometro";
export const ACCESS_TTL_S = 60 * 60;
// O refresh gira a cada uso, então um conector em uso nunca chega a esse prazo.
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;

export const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** O que um cliente registrou (RFC 7591), como o client_id carrega. */
export interface ClientInfo {
  name?: string;
  redirect_uris: string[];
  auth: AuthMethod;
  iat: number;
  /** Dois registros iguais continuam sendo dois clientes, cada um com seu id e segredo. */
  jti: string;
}

/** O que um access ou refresh token concede: o Zerômetro, a um cliente, para um recurso. */
export interface Grant {
  /** Impressão digital do cliente (`fingerprint(client_id)`): o client_id é longo demais para embutir. */
  cid: string;
  aud: string;
  scope: string;
  /** Segundos desde a época. */
  exp: number;
  jti: string;
}

interface Payloads {
  client: ClientInfo;
  access: Grant;
  refresh: Grant;
}
type Kind = keyof Payloads;

// Prefixos legíveis: um token colado em algum lugar diz o que é (e scanners de segredo o acham).
const PREFIX: Record<Kind, string> = { client: "zm_client", access: "zm_at", refresh: "zm_rt" };

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export const randomToken = (bytes = 32) => base64url(randomBytes(bytes));

/** Compara segredos em tempo constante, sejam quais forem os tamanhos. */
export const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** O desafio PKCE S256 de um verifier (RFC 7636). */
export const s256 = (verifier: string) => base64url(createHash("sha256").update(verifier).digest());

export const fingerprint = (clientId: string) =>
  base64url(createHash("sha256").update(clientId).digest().subarray(0, 16));

export function makeSigner(secret: string) {
  // Chave própria: uma assinatura daqui nunca serve para outra coisa feita com o mesmo segredo.
  const key = createHmac("sha256", secret).update("zerometro/mcp-oauth/v1").digest();
  const mac = (data: string) => base64url(createHmac("sha256", key).update(data).digest());

  const sign = <K extends Kind>(kind: K, payload: Payloads[K]) => {
    const body = `${PREFIX[kind]}.${base64url(JSON.stringify(payload))}`;
    return `${body}.${mac(body)}`;
  };

  /** O payload, se `token` é um `kind` feito por este signer; a validade é o chamador que confere. */
  const verify = <K extends Kind>(kind: K, token: string): Payloads[K] | undefined => {
    const [prefix, payload, signature, ...rest] = token.split(".");
    if (prefix !== PREFIX[kind] || !payload || !signature || rest.length > 0) return undefined;
    if (!sameSecret(signature, mac(`${prefix}.${payload}`))) return undefined;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Payloads[K]) : undefined;
    } catch {
      return undefined;
    }
  };

  // Derivado em vez de guardado: só este signer consegue calcular, então prova que o cliente é
  // o mesmo que se registrou.
  const clientSecret = (clientId: string) => mac(`client-secret:${clientId}`);

  return { sign, verify, clientSecret };
}
