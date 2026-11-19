import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default("./data/zerometro.db"),
  TZ: z.string().min(1).default("America/Sao_Paulo"),
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),
  // Login (Better Auth + Google). O segredo assina os cookies de sessão.
  BETTER_AUTH_SECRET: z.string().min(32, "Use pelo menos 32 caracteres").optional(),
  /** URL pública do site (padrão: domínio da Railway ou http://localhost:PORT). */
  BETTER_AUTH_URL: z.url().optional(),
  /** Injetado pela Railway quando o serviço tem domínio público (sem https://). */
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** E-mails convidados, separados por vírgula; o primeiro é o dono. */
  ALLOWED_EMAILS: z.string().default(""),
  MCP_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", z.prettifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;
