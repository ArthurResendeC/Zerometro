import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => <p className="text-muted-foreground">Página não encontrada.</p>,
});

const navLinkClass =
  "rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground";

function RootLayout() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Link to="/" className="mr-4 font-semibold tracking-tight">
            🎮 Zerômetro
          </Link>
          <Link
            to="/"
            className={navLinkClass}
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
          <Button asChild size="sm" className="ml-auto">
            <Link to="/adicionar">
              <Plus />
              <span className="hidden sm:inline">Adicionar jogo</span>
            </Link>
          </Button>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <Toaster position="bottom-center" />
    </div>
  );
}
