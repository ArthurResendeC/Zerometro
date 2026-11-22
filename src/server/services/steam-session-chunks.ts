// Onde encaixar o tempo jogado na Steam entre duas sincronizações. A Steam só manda o total, então
// a sincronização (de 30 em 30 min, ou ao abrir o app) vê "pedaços": jogar 4h seguidas dá vários
// pedaços, e eles têm de virar uma sessão só. Sem banco aqui: usado na sincronização e na
// migration que reagrupou as sessões antigas (uma sessão por pedaço).
//
// - A sessão anterior está "aberta" se ainda crescia na sincronização anterior (o jogo rodava).
// - O pedaço continua a sessão anterior se ela está aberta, ou se ele começaria antes do fim dela
//   (a Steam às vezes atrasa e despeja o tempo de uma vez: 42 min numa janela de 17).
// - Pedaço que encheu a janela: o jogo ainda está rodando, a sessão termina agora (aberta).
//   Pedaço menor continuando uma aberta: parou no meio, termina em `de + pedaço` (fecha).
// - Pedaço novo: começou `pedaço` minutos antes de agora e fica aberto (se a próxima sincronização
//   não vir tempo novo, ela fecha sozinha).
// Minutos = fim − início sempre, como nas sessões de timer (a edição conta com isso).

/** Folga para o atraso da Steam ao atualizar o total (56 min numa janela de 60 = cheia). */
export const STEAM_SESSION_SLACK_MS = 10 * 60_000;

export interface SteamChunk {
  minutes: number;
  /** Sincronização anterior (a base). */
  from: Date;
  /** Esta sincronização. */
  to: Date;
}

export interface TimedSteamSession {
  minutes: number;
  endedAt: Date;
}

export interface SteamChunkPlacement {
  /** Estende a sessão anterior (os valores são o total dela) ou cria uma nova. */
  extend: boolean;
  minutes: number;
  startedAt: Date;
  endedAt: Date;
}

const MINUTE = 60_000;

export function placeSteamChunk(
  chunk: SteamChunk,
  previous: TimedSteamSession | null,
): SteamChunkPlacement {
  const chunkMs = chunk.minutes * MINUTE;
  const windowMs = chunk.to.getTime() - chunk.from.getTime();
  const full = chunkMs >= windowMs - STEAM_SESSION_SLACK_MS;
  const open =
    previous !== null &&
    previous.endedAt.getTime() >= chunk.from.getTime() - STEAM_SESSION_SLACK_MS;
  const startsBeforePreviousEnd =
    previous !== null &&
    chunk.to.getTime() - chunkMs <= previous.endedAt.getTime() + STEAM_SESSION_SLACK_MS;

  if (previous && (open || startsBeforePreviousEnd)) {
    const minutes = previous.minutes + chunk.minutes;
    const endedAt = open && !full ? new Date(chunk.from.getTime() + chunkMs) : chunk.to;
    return {
      extend: true,
      minutes,
      startedAt: new Date(endedAt.getTime() - minutes * MINUTE),
      endedAt,
    };
  }
  return {
    extend: false,
    minutes: chunk.minutes,
    startedAt: new Date(chunk.to.getTime() - chunkMs),
    endedAt: chunk.to,
  };
}

export interface RecordedSteamChunk {
  minutes: number;
  /** Quando a sincronização gravou o pedaço. */
  syncedAt: Date;
}

/** Sincronizações seguidas do job antigo, de hora em hora (com folga): a anterior é a base da próxima. */
export const LEGACY_SYNC_GAP_MS = 75 * MINUTE;

/**
 * Reagrupa pedaços já gravados (um por sincronização, em ordem). Devolve, para cada pedaço, o
 * índice da sessão em que ele entra e as sessões resultantes.
 */
export function groupSteamChunks(chunks: RecordedSteamChunk[]): {
  groupOf: number[];
  sessions: { minutes: number; startedAt: Date; endedAt: Date }[];
} {
  const sessions: { minutes: number; startedAt: Date; endedAt: Date }[] = [];
  const groupOf: number[] = [];
  let previousSync: Date | null = null;
  for (const chunk of chunks) {
    const consecutive =
      previousSync !== null &&
      chunk.syncedAt.getTime() - previousSync.getTime() <= LEGACY_SYNC_GAP_MS;
    // Sem a sincronização anterior conhecida, a janela é o próprio pedaço.
    const from =
      consecutive && previousSync
        ? previousSync
        : new Date(chunk.syncedAt.getTime() - chunk.minutes * MINUTE);
    const last = sessions.at(-1) ?? null;
    const placement = placeSteamChunk({ minutes: chunk.minutes, from, to: chunk.syncedAt }, last);
    const session = {
      minutes: placement.minutes,
      startedAt: placement.startedAt,
      endedAt: placement.endedAt,
    };
    if (placement.extend) sessions[sessions.length - 1] = session;
    else sessions.push(session);
    groupOf.push(sessions.length - 1);
    previousSync = chunk.syncedAt;
  }
  return { groupOf, sessions };
}
