import type { ActivityActor } from "../../shared/domain";
import type { DbOrTx } from "../db/client";
import { activityLog } from "../db/schema";

/** Registra uma escrita no log de auditoria (quem mudou o quê, e por onde). */
export function logActivity(
  db: DbOrTx,
  who: { actor: ActivityActor; userId: string },
  action: string,
  payload: Record<string, unknown>,
): void {
  db.insert(activityLog).values({ userId: who.userId, actor: who.actor, action, payload }).run();
}
