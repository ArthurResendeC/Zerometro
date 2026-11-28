import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default("./data/zerometro.db"),
  TZ: z.string().min(1).default("America/Sao_Paulo"),
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),
  /** Chave da Steam Web API (lista de conquistas). Sem ela, a Steam fica desligada. */
  STEAM_WEB_API_KEY: z.string().trim().optional(),
  /** Chave da API do RetroAchievements. Sem ela, o RA fica desligado. */
  RA_API_KEY: z.string().trim().optional(),
  /** Token do admin da instância (primeiro acesso, scripts e MCP). Obrigatório para o servidor subir. */
  ZEROMETRO_TOKEN: z.string().trim().optional(),
  /**
   * Chave dos cookies de sessão e do OAuth do MCP (gere com: mise run token). Sem ela, sai do
   * ZEROMETRO_TOKEN; com ela, trocar o token não desloga os perfis.
   */
  SESSION_SECRET: z.string().trim().optional(),
  /** URL pública do site (padrão: domínio da Railway ou http://localhost:PORT). */
  PUBLIC_URL: z.url().optional(),
  /** Injetado pela Railway quando o serviço tem domínio público (sem https://). */
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", z.prettifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;
