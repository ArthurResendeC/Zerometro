import { and, asc, eq } from "drizzle-orm";
import {
  DEFAULT_SOUND_PACK,
  type GrantItemInput,
  isFreeItem,
  type ItemKind,
  type ItemSource,
  type OwnedItem,
  themeSoundPack,
} from "../../shared/items";
import { DEFAULT_THEME, isThemeId } from "../../shared/themes";
import type { DbOrTx } from "../db/client";
import { user, userItems } from "../db/schema";
import { NotFoundError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";

// Posse de itens de personalização. O que é de graça não tem linha; quem tem um tema leva o
// pacote de som dele junto (ganhar o tema grava os dois).

/** Os itens grátis, iguais para todo mundo. */
const freeItems: OwnedItem[] = [
  { kind: "theme", itemId: DEFAULT_THEME, source: null, acquiredAt: null },
  { kind: "sound_pack", itemId: DEFAULT_SOUND_PACK, source: null, acquiredAt: null },
];

/** Tudo o que o usuário tem: os grátis primeiro, depois os ganhos (por ordem de chegada). */
export function listItems({ db, userId }: UserScope): OwnedItem[] {
  const rows = db
    .select({
      kind: userItems.kind,
      itemId: userItems.itemId,
      source: userItems.source,
      acquiredAt: userItems.acquiredAt,
    })
    .from(userItems)
    .where(eq(userItems.userId, userId))
    .orderBy(asc(userItems.acquiredAt), asc(userItems.id))
    .all();
  return [...freeItems, ...rows];
}

export function ownsItem({ db, userId }: UserScope, kind: ItemKind, itemId: string): boolean {
  if (isFreeItem(kind, itemId)) return true;
  const row = db
    .select({ id: userItems.id })
    .from(userItems)
    .where(
      and(eq(userItems.userId, userId), eq(userItems.kind, kind), eq(userItems.itemId, itemId)),
    )
    .get();
  return row !== undefined;
}

/** Os ids que o usuário tem de um tipo (inclui os grátis). */
export function ownedIds(scope: UserScope, kind: ItemKind): Set<string> {
  return new Set(
    listItems(scope)
      .filter((item) => item.kind === kind)
      .map((item) => item.itemId),
  );
}

/**
 * Dá um item a `targetUserId` (o admin concedendo, a loja, as insígnias). Idempotente: quem já tem
 * não ganha de novo (`created: false`). Um tema traz o pacote de som dele.
 */
export function grantItem(
  ctx: ServiceContext,
  targetUserId: string,
  input: GrantItemInput,
  source: ItemSource,
): { created: boolean } {
  return ctx.db.transaction((tx) => grantItemIn(tx, ctx, targetUserId, input, source));
}

/** O mesmo que `grantItem`, dentro de uma transação que já existe (ex.: a compra, com o débito). */
export function grantItemIn(
  tx: DbOrTx,
  who: Pick<ServiceContext, "actor" | "userId" | "now">,
  targetUserId: string,
  input: GrantItemInput,
  source: ItemSource,
): { created: boolean } {
  const target = tx.select({ id: user.id }).from(user).where(eq(user.id, targetUserId)).get();
  if (!target) throw new NotFoundError("Perfil não encontrado");

  const grants: { kind: ItemKind; itemId: string }[] = [input];
  if (input.kind === "theme" && isThemeId(input.itemId)) {
    grants.push({ kind: "sound_pack", itemId: themeSoundPack[input.itemId] });
  }

  let created = false;
  for (const grant of grants) {
    if (isFreeItem(grant.kind, grant.itemId)) continue;
    const inserted = tx
      .insert(userItems)
      .values({
        userId: targetUserId,
        kind: grant.kind,
        itemId: grant.itemId,
        source,
        acquiredAt: who.now.toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: userItems.id })
      .all();
    if (inserted.length > 0 && grant === input) created = true;
  }
  if (created) logActivity(tx, who, "item.grant", { targetUserId, ...input, source });
  return { created };
}
