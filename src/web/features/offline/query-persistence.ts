import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query, QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";

// Cache do TanStack Query guardado no IndexedDB: com ele o app abre sem internet, logado e com
// os dados da última visita (só leitura). As escritas offline vão pela outbox (./outbox.ts).

/** Quanto tempo os dados guardados valem. O `gcTime` padrão do QueryClient acompanha. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const store = createStore("zerometro", "query-cache");

const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key, store),
    setItem: (key, value: string) => set(key, value, store),
    removeItem: (key) => del(key, store),
  },
  key: "zerometro:queries",
  throttleTime: 1000,
});

/** O que vale guardar: dados do usuário e páginas já vistas. Busca e telas do OAuth, não. */
const PERSISTED_ROOTS = new Set([
  "auth",
  "library",
  "sessions",
  "stats",
  "settings",
  "timer",
  "completions",
  "objectives",
  "feeds",
]);

function shouldPersist(query: Query) {
  const [root, kind] = query.queryKey as unknown[];
  if (query.state.status !== "success") return false;
  if (root === "igdb") return kind === "game"; // página do jogo sim, busca não
  return typeof root === "string" && PERSISTED_ROOTS.has(root);
}

/**
 * Identifica o build do frontend pelo nome (com hash) do script principal: um deploy com
 * formato de dados novo não lê o cache do anterior.
 */
function buildId() {
  const script = document.querySelector<HTMLScriptElement>("script[type=module][src]");
  return script?.getAttribute("src") ?? "dev";
}

const options = (queryClient: QueryClient) => ({
  queryClient,
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: buildId(),
  dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
});

/**
 * Restaura o cache guardado e passa a salvar as mudanças. Rodar antes do primeiro render:
 * o `beforeLoad` da raiz lê o login do cache, e sem rede ele só existe aqui.
 */
export async function restorePersistedQueries(queryClient: QueryClient) {
  try {
    await persistQueryClientRestore(options(queryClient));
  } catch (error) {
    // IndexedDB indisponível (aba anônima em alguns navegadores): segue sem cache offline.
    console.warn("[offline] não deu para restaurar o cache", error);
  }
  persistQueryClientSubscribe(options(queryClient));
}

/** Ao sair da conta: nada do usuário anterior pode sobrar no aparelho. */
export async function clearPersistedQueries() {
  await persister.removeClient();
}
