// Perfis da instância: login por @apelido e senha, convites de uso único e o que a sessão mostra.
// O `owner` (admin) também entra com o ZEROMETRO_TOKEN, para o primeiro acesso e emergências.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import {
  type AcceptResetInput,
  type AcceptSignupInput,
  type AuthSession,
  type Avatar,
  type ChangePasswordInput,
  type InviteStatus,
  type InviteSummary,
  type UpdateMeInput,
  type UserSummary,
  avatars,
  DEFAULT_AVATAR,
  type InviteKind,
  type InvitePreview,
  OWNER_ID,
} from "../../shared/auth";
import type { Db, DbOrTx } from "../db/client";
import { invites, playSessions, user, type User } from "../db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext } from "./context";

export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Convite inexistente, usado, revogado ou vencido: a mesma resposta para todos. */
export class InvalidInviteError extends AppError {
  constructor() {
    super(410, "invalid_invite", "Este link não vale mais. Peça um novo para quem te convidou.");
  }
}

/** O que o middleware de auth guarda da pessoa logada. */
export type AuthUser = Pick<
  User,
  "id" | "name" | "handle" | "avatar" | "role" | "passwordHash" | "sessionVersion" | "disabledAt"
>;

const authColumns = {
  id: user.id,
  name: user.name,
  handle: user.handle,
  avatar: user.avatar,
  role: user.role,
  passwordHash: user.passwordHash,
  sessionVersion: user.sessionVersion,
  disabledAt: user.disabledAt,
};

export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: "argon2id" });

/** sha256 do código do convite: só isso fica no banco. */
export const inviteHash = (code: string) => createHash("sha256").update(code).digest("hex");

const isAvatar = (value: string | null): value is Avatar =>
  (avatars as readonly string[]).includes(value ?? "");

/** Usuário que pode entrar (existe e não está suspenso), ou undefined. */
export function getActiveUser(db: DbOrTx, id: string): AuthUser | undefined {
  const row = db.select(authColumns).from(user).where(eq(user.id, id)).get();
  return row && !row.disabledAt ? row : undefined;
}

export function toSession(row: AuthUser): AuthSession {
  return {
    userId: row.id,
    name: row.name,
    handle: row.handle,
    avatar: isAvatar(row.avatar) ? row.avatar : DEFAULT_AVATAR,
    role: row.role,
    hasPassword: row.passwordHash !== null,
  };
}

// Hash de uma senha qualquer: com um @apelido que não existe, a verificação gasta o mesmo tempo
// (não dá para descobrir quem tem conta pelo tempo de resposta).
let decoyHash: Promise<string> | undefined;

/** Confere @apelido e senha; devolve o usuário ou undefined (sem dizer qual dos dois errou). */
export async function verifyLogin(
  db: Db,
  handle: string,
  password: string,
): Promise<AuthUser | undefined> {
  const row = db.select(authColumns).from(user).where(eq(user.handle, handle)).get();
  decoyHash ??= hashPassword(randomBytes(16).toString("hex"));
  const hash = row?.passwordHash ?? (await decoyHash);
  const ok = await Bun.password.verify(password, hash);
  return ok && row?.passwordHash && !row.disabledAt ? row : undefined;
}

/** Cria um convite (ou link de redefinição para `targetUserId`) e devolve o código do link. */
export function createInvite(
  db: DbOrTx,
  who: { userId: string; now: Date },
  input: { kind?: InviteKind; note?: string | null; targetUserId?: string },
): { id: number; code: string; expiresAt: string } {
  const kind = input.kind ?? "signup";
  if (kind === "reset" && !input.targetUserId) throw new NotFoundError("Perfil não encontrado");
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(who.now.getTime() + INVITE_TTL_DAYS * DAY_MS).toISOString();
  const row = db
    .insert(invites)
    .values({
      kind,
      tokenHash: inviteHash(code),
      createdBy: who.userId,
      targetUserId: kind === "reset" ? input.targetUserId : null,
      note: input.note?.trim() || null,
      expiresAt,
    })
    .returning({ id: invites.id })
    .get();
  return { id: row.id, code, expiresAt };
}

/** Convite válido pelo código, ou erro 410. */
function openInvite(db: DbOrTx, code: string, now: Date) {
  const row = db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, inviteHash(code)), isNull(invites.usedAt)))
    .get();
  if (!row || row.revokedAt || row.expiresAt <= now.toISOString()) throw new InvalidInviteError();
  return row;
}

export function previewInvite(db: Db, code: string, now: Date): InvitePreview {
  const invite = openInvite(db, code, now);
  if (invite.kind === "reset") {
    const target = getActiveUser(db, invite.targetUserId!);
    if (!target) throw new InvalidInviteError();
    return { kind: "reset", name: target.name, handle: target.handle ?? "" };
  }
  const by = db.select({ name: user.name }).from(user).where(eq(user.id, invite.createdBy)).get();
  return { kind: "signup", invitedBy: by?.name ?? "o admin" };
}

const handleTaken = (db: DbOrTx, handle: string) =>
  db.select({ id: user.id }).from(user).where(eq(user.handle, handle)).get() !== undefined;

/** Aceita um convite de perfil novo: cria o usuário e gasta o convite, tudo junto. */
export async function acceptSignup(
  db: Db,
  code: string,
  input: AcceptSignupInput,
  now: Date,
): Promise<AuthUser> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction((tx) => {
    const invite = openInvite(tx, code, now);
    if (invite.kind !== "signup") throw new InvalidInviteError();
    if (handleTaken(tx, input.handle)) throw new ConflictError(`@${input.handle} já está em uso`);
    const id = crypto.randomUUID();
    tx.insert(user)
      .values({
        id,
        name: input.name,
        email: `${id}@zerometro.invalid`,
        handle: input.handle,
        avatar: input.avatar,
        passwordHash,
        role: "member",
      })
      .run();
    tx.update(invites)
      .set({ usedBy: id, usedAt: now.toISOString() })
      .where(eq(invites.id, invite.id))
      .run();
    logActivity(tx, { actor: "web", userId: id }, "user.signup", { inviteId: invite.id });
    return getActiveUser(tx, id)!;
  });
}

/** Aceita um link de redefinição: senha nova e todos os aparelhos deslogados. */
export async function acceptReset(
  db: Db,
  code: string,
  input: AcceptResetInput,
  now: Date,
): Promise<AuthUser> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction((tx) => {
    const invite = openInvite(tx, code, now);
    const target = invite.kind === "reset" ? getActiveUser(tx, invite.targetUserId!) : undefined;
    if (!target) throw new InvalidInviteError();
    setPassword(tx, target.id, passwordHash);
    tx.update(invites)
      .set({ usedBy: target.id, usedAt: now.toISOString() })
      .where(eq(invites.id, invite.id))
      .run();
    logActivity(tx, { actor: "web", userId: target.id }, "user.password_reset", {
      inviteId: invite.id,
    });
    return getActiveUser(tx, target.id)!;
  });
}

/** Grava a senha e incrementa a versão da sessão (os cookies antigos param de valer). */
export function setPassword(db: DbOrTx, userId: string, passwordHash: string): void {
  bumpSessionVersion(db, userId, { passwordHash });
}

export function bumpSessionVersion(
  db: DbOrTx,
  userId: string,
  extra: Partial<Pick<User, "passwordHash">> = {},
): void {
  const row = db.select({ v: user.sessionVersion }).from(user).where(eq(user.id, userId)).get();
  if (!row) throw new NotFoundError("Perfil não encontrado");
  db.update(user)
    .set({ ...extra, sessionVersion: row.v + 1 })
    .where(eq(user.id, userId))
    .run();
}

/** O admin (dono dos dados de antes dos perfis), com quem o ZEROMETRO_TOKEN entra. */
export function getOwner(db: DbOrTx): AuthUser {
  const owner = getActiveUser(db, OWNER_ID);
  if (!owner) throw new NotFoundError("O admin da instância não existe");
  return owner;
}

/** Muda nome e avatar do próprio perfil. */
export function updateProfile(ctx: ServiceContext, patch: UpdateMeInput): AuthUser {
  ctx.db.update(user).set(patch).where(eq(user.id, ctx.userId)).run();
  logActivity(ctx.db, ctx, "user.update", patch);
  return getActiveUser(ctx.db, ctx.userId)!;
}

/**
 * Troca a senha (a atual é obrigatória para quem já tem uma) e derruba os outros aparelhos:
 * quem chamou recebe o perfil na versão nova, para reemitir o próprio cookie.
 */
export async function changePassword(
  ctx: ServiceContext,
  input: ChangePasswordInput,
): Promise<AuthUser> {
  const me = getActiveUser(ctx.db, ctx.userId);
  if (!me) throw new NotFoundError("Perfil não encontrado");
  if (me.passwordHash) {
    const ok = await Bun.password.verify(input.current ?? "", me.passwordHash);
    if (!ok) throw new AppError(403, "wrong_password", "A senha atual não confere");
  }
  setPassword(ctx.db, ctx.userId, await hashPassword(input.password));
  logActivity(ctx.db, ctx, "user.password_change", {});
  return getActiveUser(ctx.db, ctx.userId)!;
}

/** "Sair de todos os aparelhos": os cookies e os conectores de antes param de valer. */
export function signOutEverywhere(ctx: ServiceContext): AuthUser {
  bumpSessionVersion(ctx.db, ctx.userId);
  logActivity(ctx.db, ctx, "user.sign_out_everywhere", {});
  return getActiveUser(ctx.db, ctx.userId)!;
}

/** Todos os perfis (para o admin), do mais antigo ao mais novo. */
export function listUsers({ db }: Pick<ServiceContext, "db">): UserSummary[] {
  const lastPlayed = db
    .select({ userId: playSessions.userId, last: max(playSessions.playedOn).as("last") })
    .from(playSessions)
    .groupBy(playSessions.userId)
    .as("last_played");
  return db
    .select({ row: user, last: lastPlayed.last })
    .from(user)
    .leftJoin(lastPlayed, eq(lastPlayed.userId, user.id))
    .orderBy(asc(user.createdAt))
    .all()
    .map(({ row, last }) => ({
      userId: row.id,
      name: row.name,
      handle: row.handle,
      avatar: isAvatar(row.avatar) ? row.avatar : DEFAULT_AVATAR,
      role: row.role,
      disabled: row.disabledAt !== null,
      createdAt: row.createdAt.toISOString(),
      lastPlayedOn: last ?? null,
    }));
}

/** Os convites e links de redefinição, dos mais novos aos mais velhos. */
export function listInvites({ db, now }: Pick<ServiceContext, "db" | "now">): InviteSummary[] {
  const rows = db.select().from(invites).orderBy(desc(invites.id)).all();
  const people = new Map(
    db
      .select({ id: user.id, name: user.name, handle: user.handle })
      .from(user)
      .all()
      .map((p) => [p.id, { name: p.name, handle: p.handle }]),
  );
  const at = now.toISOString();
  return rows.map((row) => {
    const status: InviteStatus = row.usedAt
      ? "used"
      : row.revokedAt
        ? "revoked"
        : row.expiresAt <= at
          ? "expired"
          : "pending";
    const who = row.kind === "reset" ? row.targetUserId : row.usedBy;
    return {
      id: row.id,
      kind: row.kind,
      note: row.note,
      status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      user: (who && people.get(who)) || null,
    };
  });
}

/** Revoga um convite ainda não usado. */
export function revokeInvite(ctx: ServiceContext, id: number): void {
  const row = ctx.db.select().from(invites).where(eq(invites.id, id)).get();
  if (!row) throw new NotFoundError("Convite não encontrado");
  if (row.usedAt) throw new ConflictError("Este convite já foi usado");
  if (row.revokedAt) return;
  ctx.db.update(invites).set({ revokedAt: ctx.now.toISOString() }).where(eq(invites.id, id)).run();
  logActivity(ctx.db, ctx, "invite.revoke", { inviteId: id });
}

/**
 * Suspende (ou reativa) um perfil: suspenso não entra, os conectores param e ele some do grupo;
 * os dados ficam. O admin não se suspende.
 */
export function setUserDisabled(ctx: ServiceContext, userId: string, disabled: boolean): void {
  const row = ctx.db.select({ role: user.role }).from(user).where(eq(user.id, userId)).get();
  if (!row) throw new NotFoundError("Perfil não encontrado");
  if (row.role === "admin") throw new ConflictError("Não dá para suspender o admin");
  ctx.db
    .update(user)
    .set({ disabledAt: disabled ? ctx.now.toISOString() : null })
    .where(eq(user.id, userId))
    .run();
  logActivity(ctx.db, ctx, disabled ? "user.disable" : "user.enable", { userId });
}

/** Link de redefinição de senha para um perfil ativo (o admin manda para a pessoa). */
export function createResetLink(ctx: ServiceContext, userId: string) {
  if (!getActiveUser(ctx.db, userId)) throw new NotFoundError("Perfil não encontrado");
  const created = createInvite(ctx.db, ctx, { kind: "reset", targetUserId: userId });
  logActivity(ctx.db, ctx, "invite.create", { inviteId: created.id, kind: "reset", userId });
  return created;
}
