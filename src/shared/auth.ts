import { z } from "zod";

// Login do site com o token da instância (ZEROMETRO_TOKEN), compartilhado por API e frontend.

/** O admin da instância: o primeiro usuário, dono dos dados de antes dos perfis. */
export const OWNER_ID = "owner";

export const userRoles = ["admin", "member"] as const;
export type UserRole = (typeof userRoles)[number];

/** `signup`: cria um perfil; `reset`: redefine a senha de um perfil que já existe. */
export const inviteKinds = ["signup", "reset"] as const;
export type InviteKind = (typeof inviteKinds)[number];

/** Avatares pixel art que dá para escolher (desenhados em `src/web/features/profile/avatars`). */
export const avatars = [
  "flame",
  "ghost",
  "slime",
  "sword",
  "potion",
  "mushroom",
  "skull",
  "cat",
  "star",
  "heart",
  "controller",
  "crown",
] as const;
export type Avatar = (typeof avatars)[number];
export const DEFAULT_AVATAR: Avatar = "flame";

export const MIN_PASSWORD_LENGTH = 8;

/** @apelido: o login e o endereço do perfil (minúsculo, sem acento). */
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Use de 3 a 20 letras sem acento, números ou _");

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres`)
  .max(200, "Senha longa demais");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Informe um nome")
  .max(40, "Nome longo demais");

/** Entrar com o @apelido e a senha, ou (o admin) com o token da instância. */
export const loginInputSchema = z.union([
  z.object({
    handle: z.string().trim().toLowerCase().min(1, "Informe o @apelido"),
    password: z.string().min(1, "Informe a senha"),
  }),
  z.object({ token: z.string().trim().min(1, "Informe o token de acesso") }),
]);
export type LoginInput = z.infer<typeof loginInputSchema>;

/** Criar o perfil a partir de um convite. */
export const acceptSignupSchema = z.object({
  name: displayNameSchema,
  handle: handleSchema,
  avatar: z.enum(avatars),
  password: passwordSchema,
});
export type AcceptSignupInput = z.infer<typeof acceptSignupSchema>;

/** Redefinir a senha a partir de um link de redefinição. */
export const acceptResetSchema = z.object({ password: passwordSchema });
export type AcceptResetInput = z.infer<typeof acceptResetSchema>;

/** O que a página do convite mostra antes de aceitar (GET /api/auth/invites/:code). */
export type InvitePreview =
  | { kind: "signup"; invitedBy: string }
  | { kind: "reset"; name: string; handle: string };

/** Resposta de GET /api/auth/session (e do login): quem está usando o app. */
export interface AuthSession {
  userId: string;
  name: string;
  handle: string | null;
  avatar: Avatar;
  role: UserRole;
  /** Já tem senha? O admin pode entrar só pelo token até definir uma. */
  hasPassword: boolean;
}

/** Mudar nome e avatar (PATCH /api/me). */
export const updateMeSchema = z
  .object({ name: displayNameSchema, avatar: z.enum(avatars) })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para mudar");
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Trocar a senha: a atual é obrigatória para quem já tem uma. */
export const changePasswordSchema = z.object({
  current: z.string().optional(),
  password: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createInviteSchema = z.object({
  note: z.string().trim().max(60, "Nota longa demais").optional(),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/** Link de convite ou de redefinição recém-gerado: o código só aparece agora. */
export interface CreatedInvite {
  id: number;
  url: string;
  expiresAt: string;
}

/** Um perfil na lista do admin. */
export interface UserSummary {
  userId: string;
  name: string;
  handle: string | null;
  avatar: Avatar;
  role: UserRole;
  disabled: boolean;
  /** Entrou na instância (ISO UTC). */
  createdAt: string;
  /** Último dia com sessão (YYYY-MM-DD), ou null. */
  lastPlayedOn: string | null;
}

export type InviteStatus = "pending" | "used" | "revoked" | "expired";

/** Um convite na lista do admin (sem o código, que não fica guardado). */
export interface InviteSummary {
  id: number;
  kind: InviteKind;
  note: string | null;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  /** Quem usou (signup) ou de quem é a redefinição (reset). */
  user: { name: string; handle: string | null } | null;
}
