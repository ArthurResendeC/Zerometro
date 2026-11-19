import type { ActivityActor } from "../../shared/domain";
import type { DbOrTx } from "../db/client";
import { activityLog } from "../db/schema";

/** Registra uma escrita no log de auditoria (quem mudou o quê, e por onde). */
export function logActivity(
  db: DbOrTx,
  actor: ActivityActor,
  action: string,
  payload: Record<string, unknown>,
): void {
  db.insert(activityLog).values({ actor, action, payload }).run();
}
