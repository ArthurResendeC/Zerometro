import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { reachedStreakMilestone } from "@/features/audio/sound-events";
import { playMostImportant } from "@/features/audio/use-sound";
import { api, unwrap } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { currentUserId, isOffline, requestOptions, setSyncTrigger } from "./actions";
import { OUTBOX_STORAGE_KEY, useOutbox, userItems } from "./outbox";
import { type OutboxItem, type SendResult, savedSession, syncItems } from "./outbox-core";
import type { LogSessionResult } from "@shared/sessions";
import type { ActiveSession } from "@shared/timer";

// Envia a fila offline para o servidor: ao abrir o app, quando a conexão volta, ao voltar para a
// aba e a cada 30s enquanto houver pendentes. Uma aba por vez (Web Locks).

const RETRY_INTERVAL_MS = 30_000;
const LOCK_NAME = "zerometro-outbox";

let queryClient: QueryClient | null = null;
let running: Promise<void> | null = null;

export function initOutboxSync(client: QueryClient) {
  queryClient = client;
  setSyncTrigger(() => void syncOutbox());
  window.addEventListener("online", () => void syncOutbox());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncOutbox();
  });
  // Outra aba mexeu na fila: lê de novo, para não sobrescrever com uma versão velha.
  window.addEventListener("storage", (event) => {
    if (event.key === OUTBOX_STORAGE_KEY) void useOutbox.persist.rehydrate();
  });
  setInterval(() => {
    const userId = currentUserId(client);
    if (userId && userItems(userId).some((item) => item.status === "pending")) void syncOutbox();
  }, RETRY_INTERVAL_MS);
  void syncOutbox();
}

/** Envia o que estiver pendente; chamadas concorrentes esperam a mesma rodada. */
export function syncOutbox(): Promise<void> {
  running ??= withLock(run).finally(() => {
    running = null;
  });
  return running;
}

async function withLock(task: () => Promise<void>) {
  if (!navigator.locks) return task();
  // Outra aba já está enviando: ela cuida (e esta relê a fila pelo evento `storage`).
  await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (lock) await task();
  });
}

async function run() {
  const client = queryClient;
  const userId = client && currentUserId(client);
  if (!client || !userId || isOffline()) return;

  await useOutbox.persist.rehydrate(); // o estado mais novo, inclusive de outras abas
  const items = userItems(userId);
  if (!items.some((item) => item.status === "pending")) return;

  const saved: { item: OutboxItem; session: LogSessionResult }[] = [];
  const failed: OutboxItem[] = [];
  /** clientId do start → id do timer no servidor (para atualizar o cache depois do stop). */
  const startedIds = new Map<string, number>();
  const { stoppedBy } = await syncItems(items, {
    send,
    onSent: (item, result) => {
      useOutbox.getState().remove(item.id);
      updateTimerCache(client, item, result, startedIds);
      const session = savedSession(result);
      if (session) saved.push({ item, session });
    },
    onFailed: (item, error) => {
      useOutbox.getState().markFailed(item.id, error);
      failed.push(item);
    },
  });

  if (saved.length > 0 || failed.length > 0) {
    await Promise.all(
      ["timer", "library", "sessions", "stats"].map((root) =>
        client.invalidateQueries({ queryKey: [root] }),
      ),
    );
  }
  announce(saved, failed);
  if (stoppedBy === "unauthorized") {
    // Sessão expirou: a próxima consulta à API leva ao login; a fila espera.
    void client.invalidateQueries({ queryKey: ["auth", "session"] });
  }
}

async function send(item: OutboxItem): Promise<SendResult> {
  const { op } = item;
  switch (op.kind) {
    case "log":
      return {
        kind: "log",
        result: await unwrap(api.sessions.$post({ json: op.input }, requestOptions())),
      };
    case "timer.start":
      return {
        kind: "timer.start",
        result: await unwrap(api.timer.start.$post({ json: op.input }, requestOptions())),
      };
    case "timer.stop":
      return {
        kind: "timer.stop",
        result: await unwrap(api.timer.stop.$post({ json: op.input }, requestOptions())),
      };
    case "timer.cancel": {
      const query =
        "id" in op.target ? { id: String(op.target.id) } : { clientId: op.target.clientId };
      await unwrap(api.timer.$delete({ query }, requestOptions()));
      return { kind: "timer.cancel" };
    }
  }
}

type TimerCache = { active: ActiveSession | null; now: string; clockOffsetMs: number };

/** Evita o timer "piscar" entre o item sair da fila e a consulta ao servidor voltar. */
function updateTimerCache(
  client: QueryClient,
  item: OutboxItem,
  result: SendResult,
  startedIds: Map<string, number>,
) {
  const { op } = item;
  if (result.kind === "timer.start" && result.result.active) {
    const { active } = result.result;
    if (op.kind === "timer.start") startedIds.set(op.input.clientId, active.id);
    client.setQueryData<TimerCache>(["timer"], (old) => old && { ...old, active });
    return;
  }
  if (op.kind !== "timer.stop" && op.kind !== "timer.cancel") return;
  const target = op.kind === "timer.stop" ? op.input.target : op.target;
  const id = "id" in target ? target.id : startedIds.get(target.clientId);
  client.setQueryData<TimerCache>(["timer"], (old) =>
    old?.active && (id === undefined || old.active.id === id) ? { ...old, active: null } : old,
  );
}

function announce(saved: { item: OutboxItem; session: LogSessionResult }[], failed: OutboxItem[]) {
  if (saved.length > 0) {
    const count = saved.length;
    toast.success(count === 1 ? "Sessão sincronizada" : `${count} sessões sincronizadas`, {
      description: saved
        .map(
          ({ session }) =>
            `${session.session.gameName} · ${formatMinutes(session.session.minutes)}`,
        )
        .join("\n"),
    });
    if (saved.some(({ session }) => reachedStreakMilestone(session.streak))) {
      playMostImportant(["streak-milestone"]);
    }
  }
  if (failed.length > 0) {
    toast.error(
      failed.length === 1
        ? "Uma ação feita offline não foi aceita"
        : `${failed.length} ações feitas offline não foram aceitas`,
      { description: "Veja o motivo em pendentes, no topo da tela." },
    );
  }
}
