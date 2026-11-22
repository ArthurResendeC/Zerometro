import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { todayIn } from "../../shared/dates";
import { groupSteamChunks } from "../services/steam-session-chunks";
import type { Db, Tx } from "./client";
import { kv, playSessions } from "./schema";

// Migrations de dados em TS, para o que não dá para escrever em SQL. Rodam uma vez, depois das
// migrations do Drizzle (o schema já está atual), cada uma numa transação; a chave
// `data-migration:<nome>` no kv marca as que já rodaram.

interface DataMigration {
  name: string;
  run: (tx: Tx, options: { timeZone: string }) => void;
}

const migrations: DataMigration[] = [
  {
    // Antes, cada sincronização da Steam virava uma sessão sem horário (4h jogadas = 4 sessões
    // de 1h). Reagrupa com a regra nova, usando o created_at como a hora da sincronização. Só as
    // que ficaram no dia da sincronização: as que foram jogadas para trás (base antiga) ficam.
    name: "regroup-steam-sessions",
    run(tx, { timeZone }) {
      const rows = tx
        .select({
          id: playSessions.id,
          userId: playSessions.userId,
          gameId: playSessions.gameId,
          playedOn: playSessions.playedOn,
          minutes: playSessions.minutes,
          createdAt: playSessions.createdAt,
        })
        .from(playSessions)
        .where(
          and(
            eq(playSessions.source, "steam"),
            isNull(playSessions.startedAt),
            isNotNull(playSessions.minutes),
          ),
        )
        .orderBy(
          asc(playSessions.userId),
          asc(playSessions.gameId),
          asc(playSessions.createdAt),
          asc(playSessions.id),
        )
        .all()
        .filter((row) => row.playedOn === todayIn(timeZone, new Date(row.createdAt)));

      const byGame = Map.groupBy(rows, (row) => `${row.userId}:${row.gameId}`);
      for (const chunks of byGame.values()) {
        const { groupOf, sessions } = groupSteamChunks(
          chunks.map((row) => ({ minutes: row.minutes ?? 0, syncedAt: new Date(row.createdAt) })),
        );
        sessions.forEach((session, index) => {
          const ids = chunks.filter((_, i) => groupOf[i] === index).map((row) => row.id);
          const [keep, ...merged] = ids;
          if (keep === undefined) return;
          tx.update(playSessions)
            .set({
              playedOn: todayIn(timeZone, session.startedAt),
              minutes: session.minutes,
              startedAt: session.startedAt.toISOString(),
              endedAt: session.endedAt.toISOString(),
            })
            .where(eq(playSessions.id, keep))
            .run();
          if (merged.length > 0)
            tx.delete(playSessions).where(inArray(playSessions.id, merged)).run();
        });
      }
    },
  },
];

export function runDataMigrations(db: Db, timeZone: string): void {
  for (const migration of migrations) {
    const key = `data-migration:${migration.name}`;
    if (db.select({ key: kv.key }).from(kv).where(eq(kv.key, key)).get()) continue;
    db.transaction((tx) => {
      migration.run(tx, { timeZone });
      tx.insert(kv).values({ key, value: new Date().toISOString() }).run();
    });
  }
}
