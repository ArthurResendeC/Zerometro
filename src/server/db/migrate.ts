// Aplica as migrations pendentes no banco de DATABASE_PATH (tarefa `mise run db:migrate`).
import { env } from "../env";
import { createDb, runMigrations } from "./client";

const db = createDb(env.DATABASE_PATH);
runMigrations(db);
db.$client.close();

console.log(`Migrations aplicadas em ${env.DATABASE_PATH}`);
