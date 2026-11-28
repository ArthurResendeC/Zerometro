import { z } from "zod";

// Login do site com o token da instância (ZEROMETRO_TOKEN), compartilhado por API e frontend.

/** O admin da instância: o primeiro usuário, dono dos dados de antes dos perfis. */
export const OWNER_ID = "owner";

export const userRoles = ["admin", "member"] as const;
export type UserRole = (typeof userRoles)[number];

/** `signup`: cria um perfil; `reset`: redefine a senha de um perfil que já existe. */
export const inviteKinds = ["signup", "reset"] as const;
export type InviteKind = (typeof inviteKinds)[number];

export const loginInputSchema = z.object({
  token: z.string().trim().min(1, "Informe o token de acesso"),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/** Resposta de GET /api/auth/session: quem é o dono dos dados desta instância. */
export interface AuthSession {
  userId: string;
}
