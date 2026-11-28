import { describe, expect, test } from "bun:test";
import { SourceRateLimitedError } from "../errors";
import { createRequestGate, parseRetryAfter } from "./rate-gate";

const MIN = 60_000;

function setup() {
  let now = 0;
  const sleeps: number[] = [];
  const gate = createRequestGate({
    label: "a Steam",
    minIntervalMs: 100,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { gate, sleeps, advance: (ms: number) => (now += ms), at: () => now };
}

describe("createRequestGate", () => {
  test("fila: intervalo mínimo entre as chamadas", async () => {
    const { gate, sleeps } = setup();
    await Promise.all([gate.acquire(), gate.acquire(), gate.acquire()]);
    expect(sleeps).toEqual([100, 200]);
  });

  test("pausa de 5min na primeira recusa, dobrando nas seguidas (até 1h)", () => {
    const { gate } = setup();
    expect(gate.pausedUntil()).toBeNull();
    const pauses = [1, 2, 3, 4, 5, 6].map(() => gate.rateLimited(null).until.getTime());
    // Sem o relógio andar, cada recusa empurra o fim da pausa para max(atual, agora + backoff).
    expect(pauses).toEqual([5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN, 60 * MIN, 60 * MIN]);
  });

  test("em pausa: recusa sem esperar a fila; depois da pausa, libera", async () => {
    const { gate, advance, sleeps } = setup();
    const error = gate.rateLimited(null);
    expect(error).toBeInstanceOf(SourceRateLimitedError);
    expect(error.status).toBe(503);
    expect(error.message).toStartWith("A Steam pediu uma pausa nas consultas");

    await expect(gate.acquire()).rejects.toBeInstanceOf(SourceRateLimitedError);
    expect(sleeps).toEqual([]);
    advance(5 * MIN);
    await gate.acquire();
    expect(gate.pausedUntil()).toBeNull();
  });

  test("Retry-After maior que o backoff manda; uma resposta normal zera as recusas", () => {
    const { gate, advance, at } = setup();
    expect(gate.rateLimited(30 * MIN).until.getTime()).toBe(30 * MIN);
    advance(30 * MIN);
    gate.succeeded();
    // Recomeça em 5min, não 10.
    expect(gate.rateLimited(null).until.getTime()).toBe(at() + 5 * MIN);
  });

  test("quem estava na fila quando a pausa começou também desiste", async () => {
    let now = 0;
    const gate = createRequestGate({
      label: "a Steam",
      minIntervalMs: 100,
      now: () => now,
      // Enquanto o segundo espera a vez, chega uma recusa.
      sleep: async (ms) => {
        gate.rateLimited(null);
        now += ms;
      },
    });
    await gate.acquire();
    await expect(gate.acquire()).rejects.toBeInstanceOf(SourceRateLimitedError);
  });
});

describe("parseRetryAfter", () => {
  test("segundos, data HTTP, vazio e lixo", () => {
    const now = Date.parse("2026-11-28T12:00:00Z");
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("Sat, 28 Nov 2026 12:10:00 GMT", now)).toBe(10 * MIN);
    expect(parseRetryAfter("Sat, 28 Nov 2026 11:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("logo", now)).toBeNull();
  });
});
