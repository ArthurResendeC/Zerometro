import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
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
    // 401 não melhora tentando de novo.
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 3,
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
