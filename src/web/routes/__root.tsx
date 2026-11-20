import type { QueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { ChartIcon, ListIcon, PlusIcon, TimerIcon } from "@/components/icons";
import { LogSessionDialog } from "@/components/log-session-dialog";
import { TimerBar } from "@/components/timer";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { UserAvatar } from "@/components/user-avatar";
import { SoundToggle } from "@/features/audio/sound-toggle";
import { OfflineBanner } from "@/features/offline/offline-banner";
import { PendingIndicator } from "@/features/offline/pending-indicator";
import { InstallAppToast } from "@/features/pwa/install-toast";
import { isOAuthFlow } from "@/lib/auth-client";
import { sessionQuery } from "@/lib/queries";
import { useLogSessionDialog } from "@/stores/log-session-dialog";

const LOGIN_PATH = "/entrar";
/** Consentimento do fluxo OAuth dos clientes MCP: tela cheia, sem o cabeçalho do app. */
const CONSENT_PATH = "/autorizar";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Tudo exige login, menos a própria tela de login.
  beforeLoad: async ({ context, location }) => {
    // Sem rede e sem sessão guardada no aparelho, não há como saber: vai para o login.
    const session = await context.queryClient.ensureQueryData(sessionQuery()).catch(() => null);
    const onLogin = location.pathname === LOGIN_PATH;
    if (!session && !onLogin) {
      throw redirect({ to: LOGIN_PATH, search: { redirect: location.href } });
    }
    // Logado na tela de login vai para o início, menos no fluxo OAuth (ex.: prompt=login).
    if (session && onLogin && !isOAuthFlow(location.search)) throw redirect({ to: "/" });
    return { session };
  },
  component: RootLayout,
  notFoundComponent: () => <p className="text-muted-foreground">Página não encontrada.</p>,
});

// menu-cursor: o ▶ piscando aparece no hover e no link da página atual (aria-current).
// A fonte pixel é larga: o menu só cabe por extenso a partir de lg (texto nos links) e xl (texto
// nos botões). Abaixo disso vira ícone, senão o cabeçalho estoura a janela e cria scroll lateral.
const navLinkClass =
  "menu-cursor py-2 pr-2 display-xs max-lg:px-1 max-sm:px-0.5 max-lg:before:hidden text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:text-foreground";

function RootLayout() {
  const openLogSession = useLogSessionDialog((state) => state.openNew);
  const { session } = Route.useRouteContext();
  const pathname = useLocation({ select: (l) => l.pathname });

  if (pathname === LOGIN_PATH || pathname === CONSENT_PATH || !session) {
    return (
      <>
        <Outlet />
        <Toaster position="bottom-center" />
      </>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b-4 border-border bg-background">
        <nav className="mx-auto flex max-w-6xl items-center px-4 py-2 sm:gap-2">
          <Link
            to="/"
            className="mr-0.5 font-pixel text-[12px] whitespace-nowrap sm:mr-4 sm:text-[16px]"
          >
            Zer<span className="text-primary">ô</span>metro
          </Link>
          {/* Sem espaço para o texto, o logo já leva ao início. */}
          <Link
            to="/"
            className={`${navLinkClass} hidden lg:inline`}
            activeProps={{ className: "text-foreground" }}
            activeOptions={{ exact: true }}
          >
            Início
          </Link>
          <Link
            to="/biblioteca"
            className={navLinkClass}
            activeProps={{ className: "text-foreground" }}
            aria-label="Biblioteca"
          >
            {/* Em janelas estreitas, só o ícone: o texto não cabe ao lado dos botões. */}
            <ListIcon className="lg:hidden" />
            <span className="max-lg:hidden">Biblioteca</span>
          </Link>
          <Link
            to="/estatisticas"
            className={navLinkClass}
            activeProps={{ className: "text-foreground" }}
            aria-label="Estatísticas"
          >
            <ChartIcon className="lg:hidden" />
            <span className="max-lg:hidden">Estatísticas</span>
          </Link>
          <div className="ml-auto flex items-center">
            <PendingIndicator
              userId={session.user.id}
              className="max-sm:h-8 max-sm:gap-0.5 max-sm:px-0.5 sm:mr-1"
            />
            <SoundToggle className="max-sm:size-8 sm:mr-2" />
            <Link
              to="/ajustes"
              aria-label="Ajustes e conta"
              className="mr-1 sm:mr-3 [&[aria-current=page]>span]:shadow-[0_0_0_2px_var(--primary)]"
            >
              <UserAvatar user={session.user} />
            </Link>
            <Button
              asChild
              size="sm"
              variant="outline"
              aria-label="Adicionar jogo"
              className="max-sm:mr-2 max-xl:px-2.5"
            >
              <Link to="/adicionar">
                <PlusIcon />
                <span className="hidden xl:inline">Adicionar jogo</span>
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => openLogSession()}
              aria-label="Registrar sessão"
              className="max-sm:mr-2 max-xl:px-2.5"
            >
              <TimerIcon />
              <span className="hidden xl:inline">Registrar sessão</span>
            </Button>
          </div>
        </nav>
        <TimerBar />
        <OfflineBanner />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <Outlet />
      </main>
      <LogSessionDialog />
      <Toaster position="bottom-right" />
      <InstallAppToast />
    </div>
  );
}
