import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { PERSIST_MAX_AGE_MS, restorePersistedQueries } from "@/features/offline/query-persistence";
import { initOutboxSync } from "@/features/offline/sync";
import { listenForInstallPrompt } from "@/features/pwa/install-prompt";
import { registerServiceWorker } from "@/features/pwa/service-worker";
import { ApiError } from "@/lib/api";
import { authKeys } from "@/lib/queries";
import { routeTree } from "./routeTree.gen";

/** Sessão expirou ou foi revogada (ex.: saiu da lista de convidados): volta para o login. */
function onUnauthorized(error: Error) {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  queryClient.setQueryData(authKeys.session, null);
  if (router.state.location.pathname !== "/entrar") {
    void router.navigate({ to: "/entrar", search: { redirect: router.state.location.href } });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      // 401 não melhora tentando de novo.
      retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 3,
      // O cache vai para o IndexedDB (app offline): precisa durar tanto quanto o guardado.
      gcTime: PERSIST_MAX_AGE_MS,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  // O Query já cuida do cache; o loader do Router só dispara o fetch.
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Antes do render: o login e os dados da última visita vêm do cache guardado quando não há rede.
await restorePersistedQueries(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

initOutboxSync(queryClient);
listenForInstallPrompt();
registerServiceWorker();
