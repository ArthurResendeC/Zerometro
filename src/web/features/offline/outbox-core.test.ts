import { describe, expect, test } from "bun:test";
import type { ActiveSession, TimerTarget } from "@shared/timer";
import {
  type GameRef,
  type OutboxItem,
  type OutboxOp,
  type SendResult,
  effectiveTimer,
  savedSession,
  syncItems,
} from "./outbox-core";

const TZ = "America/Sao_Paulo";
const hades: GameRef = { gameId: 1, igdbId: 1113, name: "Hades", coverImageId: "c1" };
const celeste: GameRef = { gameId: 2, igdbId: 26226, name: "Celeste", coverImageId: null };

const server: ActiveSession = {
  id: 7,
  gameId: hades.gameId,
  igdbId: hades.igdbId,
  gameName: "Hades",
  coverImageId: "c1",
  playedOn: "2026-11-20",
  startedAt: "2026-11-20T15:00:00.000Z",
  note: null,
};

let seq = 0;
function item(op: OutboxOp, extra: Partial<OutboxItem> = {}): OutboxItem {
  seq += 1;
  return {
    id: op.kind === "timer.start" ? op.input.clientId : `item-${seq}`,
    userId: "u1",
    createdAt: "2026-11-20T15:00:00.000Z",
    op,
    status: "pending",
    ...extra,
  };
}

const start = (game: GameRef, clientId: string, startedAt: string) =>
  item({
    kind: "timer.start",
    game,
    input: { gameId: game.gameId, startedAt, clientId, replaceActive: true },
  });
const stop = (target: TimerTarget, dependsOn?: string) =>
  item(
    {
      kind: "timer.stop",
      game: hades,
      startedAt: server.startedAt,
      input: { target, endedAt: "2026-11-20T16:00:00.000Z" },
    },
    dependsOn ? { dependsOn } : {},
  );
const log = (minutes = 30) =>
  item({
    kind: "log",
    game: celeste,
    input: { gameId: 2, minutes, playedOn: "2026-11-20", clientId: `log-${minutes}` },
  });

describe("effectiveTimer", () => {
  test("sem fila, é o timer do servidor", () => {
    expect(effectiveTimer(server, [], TZ)).toMatchObject({
      id: 7,
      pending: false,
      target: { id: 7 },
    });
    expect(effectiveTimer(null, [], TZ)).toBeNull();
  });

  test("start offline vira um timer pendente, com o dia do início no fuso", () => {
    const timer = effectiveTimer(null, [start(celeste, "c-1", "2026-11-21T02:30:00.000Z")], TZ);
    expect(timer).toMatchObject({
      gameName: "Celeste",
      playedOn: "2026-11-20", // 23:30 em São Paulo
      pending: true,
      target: { clientId: "c-1" },
      outboxId: "c-1",
    });
  });

  test("stop do timer do servidor ou do pendente zera; stop de outro alvo não", () => {
    expect(effectiveTimer(server, [stop({ id: 7 })], TZ)).toBeNull();
    expect(effectiveTimer(server, [stop({ id: 99 })], TZ)).toMatchObject({ id: 7 });

    const pending = start(celeste, "c-1", "2026-11-20T16:00:00.000Z");
    expect(effectiveTimer(server, [pending, stop({ clientId: "c-1" }, "c-1")], TZ)).toBeNull();
  });

  test("trocar de jogo offline: o start novo substitui; o mesmo jogo mantém o do servidor", () => {
    expect(
      effectiveTimer(server, [start(celeste, "c-1", "2026-11-20T16:00:00.000Z")], TZ),
    ).toMatchObject({ gameName: "Celeste", pending: true });
    expect(
      effectiveTimer(server, [start(hades, "h-1", "2026-11-20T16:00:00.000Z")], TZ),
    ).toMatchObject({ id: 7, pending: false });
  });

  test("itens que falharam não contam", () => {
    const failed = { ...stop({ id: 7 }), status: "failed" as const, error: "x" };
    expect(effectiveTimer(server, [failed], TZ)).toMatchObject({ id: 7 });
  });
});

const httpError = (status: number, message = `erro ${status}`) =>
  Object.assign(new Error(message), { status });
const logResult = (minutes: number, alreadySaved?: boolean): SendResult => ({
  kind: "log",
  result: {
    session: { minutes, gameName: "Celeste" } as never,
    dayTotalMinutes: minutes,
    gameTotalMinutes: minutes,
    statusChangedTo: null,
    streak: { before: 1, current: 1 },
    ...(alreadySaved && { alreadySaved }),
  },
});

async function run(items: OutboxItem[], send: (item: OutboxItem) => Promise<SendResult>) {
  const sent: string[] = [];
  const failed: [string, string][] = [];
  const { stoppedBy } = await syncItems(items, {
    send,
    onSent: (i) => sent.push(i.id),
    onFailed: (i, error) => failed.push([i.id, error]),
  });
  return { sent, failed, stoppedBy };
}

describe("syncItems", () => {
  test("envia em ordem, um por vez", async () => {
    const order: string[] = [];
    const items = [
      start(celeste, "c-1", "2026-11-20T16:00:00.000Z"),
      stop({ clientId: "c-1" }, "c-1"),
      log(),
    ];
    const result = await run(items, async (i) => {
      order.push(i.op.kind);
      return i.op.kind === "log" ? logResult(30) : { kind: "timer.cancel" };
    });
    expect(order).toEqual(["timer.start", "timer.stop", "log"]);
    expect(result).toMatchObject({ sent: items.map((i) => i.id), failed: [], stoppedBy: null });
  });

  test("sem rede (erro que não é HTTP) para tudo e mantém o resto na fila", async () => {
    const result = await run([log(10), log(20)], async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(result).toEqual({ sent: [], failed: [], stoppedBy: "network" });
  });

  test("5xx tenta depois; 401 para esperando o login", async () => {
    expect((await run([log()], async () => Promise.reject(httpError(503)))).stoppedBy).toBe(
      "network",
    );
    expect((await run([log()], async () => Promise.reject(httpError(401)))).stoppedBy).toBe(
      "unauthorized",
    );
  });

  test("recusa (4xx) marca como falha com o motivo, e os dependentes falham junto", async () => {
    const begin = start(celeste, "c-1", "2026-11-20T14:00:00.000Z");
    const end = stop({ clientId: "c-1" }, "c-1");
    const other = log();
    const result = await run([begin, end, other], async (i) => {
      if (i.op.kind === "timer.start")
        throw httpError(409, "Hades começou às 15:00, depois deste início");
      return logResult(30);
    });
    expect(result.failed).toEqual([
      ["c-1", "Hades começou às 15:00, depois deste início"],
      [end.id, "O início deste timer não foi aceito pelo servidor"],
    ]);
    expect(result.sent).toEqual([other.id]); // o resto segue
  });

  test("404 em stop/cancel = já feito; 404 num registro é recusa", async () => {
    const result = await run([stop({ id: 7 }), log()], async () => Promise.reject(httpError(404)));
    expect(result.sent).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });

  test("ignora itens que já falharam", async () => {
    const result = await run([{ ...log(), status: "failed" }], async () => logResult(30));
    expect(result.sent).toEqual([]);
  });
});

describe("savedSession", () => {
  test("conta registros e stops novos; reenvios (alreadySaved) e descartes não", () => {
    expect(savedSession(logResult(30))?.dayTotalMinutes).toBe(30);
    expect(savedSession(logResult(30, true))).toBeNull();
    expect(
      savedSession({ kind: "timer.stop", result: { discarded: true, gameName: "Hades" } }),
    ).toBeNull();
    expect(savedSession({ kind: "gone" })).toBeNull();
  });
});
