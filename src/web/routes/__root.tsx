import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { Plus, Settings, Timer } from "lucide-react";
import { LogSessionDialog } from "@/components/log-session-dialog";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useLogSessionDialog } from "@/stores/log-session-dialog";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => <p className="text-muted-foreground">Página não encontrada.</p>,
});

const navLinkClass =
  "rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground";

function RootLayout() {
  const openLogSession = useLogSessionDialog((state) => state.openNew);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Link to="/" className="mr-2 font-semibold tracking-tight whitespace-nowrap sm:mr-4">
            🎮 Zerômetro
          </Link>
          {/* No celular o logo já leva ao início. */}
          <Link
            to="/"
            className={`${navLinkClass} hidden sm:inline`}
            activeProps={{ className: "text-foreground" }}
            activeOptions={{ exact: true }}
          >
            Início
          </Link>
          <Link
            to="/biblioteca"
            className={navLinkClass}
            activeProps={{ className: "text-foreground" }}
          >
            Biblioteca
          </Link>
          <div className="ml-auto flex gap-2">
            <Button asChild size="icon" variant="ghost" className="size-8" aria-label="Ajustes">
              <Link to="/ajustes" activeProps={{ className: "text-brand" }}>
                <Settings />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" aria-label="Adicionar jogo">
              <Link to="/adicionar">
                <Plus />
                <span className="hidden sm:inline">Adicionar jogo</span>
              </Link>
            </Button>
            <Button size="sm" onClick={() => openLogSession()} aria-label="Registrar sessão">
              <Timer />
              <span className="hidden sm:inline">Registrar sessão</span>
            </Button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <LogSessionDialog />
      <Toaster position="bottom-center" />
    </div>
  );
}
