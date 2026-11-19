import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { kv } from "../db/schema";

export function getKv(db: Db, key: string): string | null {
  return db.select({ value: kv.value }).from(kv).where(eq(kv.key, key)).get()?.value ?? null;
}

export function setKv(db: Db, key: string, value: string): void {
  db.insert(kv)
    .values({ key, value })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date().toISOString() } })
    .run();
}

export function deleteKv(db: Db, key: string): void {
  db.delete(kv).where(eq(kv.key, key)).run();
}
