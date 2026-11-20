import { z } from "zod";

// Login do site com o token da instância (ZEROMETRO_TOKEN), compartilhado por API e frontend.

/** O dono dos dados: cada instância é de uma pessoa só (a única linha de `user`). */
export const OWNER_ID = "owner";

export const loginInputSchema = z.object({
  token: z.string().trim().min(1, "Informe o token de acesso"),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/** Resposta de GET /api/auth/session: quem é o dono dos dados desta instância. */
export interface AuthSession {
  userId: string;
}
