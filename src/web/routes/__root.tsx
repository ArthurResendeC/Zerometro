import type { QueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartIcon, ListIcon, TimerIcon, UserIcon, UsersIcon } from "@/components/icons";
import { LogSessionDialog } from "@/components/log-session-dialog";
import { SessionNoteDialog } from "@/components/session-note-dialog";
import { StartSessionButton } from "@/components/start-session-dialog";
import { TimerBar } from "@/components/timer";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { SoundToggle } from "@/features/audio/sound-toggle";
import { OfflineBanner } from "@/features/offline/offline-banner";
import { PendingIndicator } from "@/features/offline/pending-indicator";
import { InstallAppToast } from "@/features/pwa/install-toast";
import { useSteamAutoSync } from "@/features/steam/use-steam-auto-sync";
import { ProfileAvatar } from "@/features/profile/avatars";
import type { AuthSession } from "@/lib/auth";
import { sessionQuery } from "@/lib/queries";
import { useLogSessionDialog } from "@/stores/log-session-dialog";

const LOGIN_PATH = "/entrar";
/** Abrem sem login: a tela de entrar e os links de convite (ou de senha nova). */
const isPublicPath = (pathname: string) =>
  pathname === LOGIN_PATH || pathname.startsWith("/convite/");

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Tudo exige login, menos a tela de login e os convites.
  beforeLoad: async ({ context, location }) => {
    // Sem rede e sem sessão guardada no aparelho, não há como saber: vai para o login.
    const session = await context.queryClient.ensureQueryData(sessionQuery()).catch(() => null);
    const onLogin = location.pathname === LOGIN_PATH;
    if (!session && !isPublicPath(location.pathname)) {
      throw redirect({ to: LOGIN_PATH, search: { redirect: location.href } });
    }
    // Já entrou: a tela de login leva ao início.
    if (session && onLogin) throw redirect({ to: "/" });
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
  const { session } = Route.useRouteContext();
  const pathname = useLocation({ select: (l) => l.pathname });

  if (isPublicPath(pathname) || !session) {
    return (
      <>
        <Outlet />
        <Toaster position="bottom-center" />
      </>
    );
  }

  return <SignedInLayout session={session} />;
}

/** O app depois de entrar: menu, timer, diálogos e a sincronização automática com a Steam. */
function SignedInLayout({ session: initial }: { session: AuthSession }) {
  // Do cache: mudar o nome ou o avatar nos ajustes já aparece aqui.
  const session = useQuery({ ...sessionQuery(), initialData: initial }).data ?? initial;
  const userId = session.userId;
  const openLogSession = useLogSessionDialog((state) => state.openNew);
  useSteamAutoSync();

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
          {/* Sem espaço para o texto, o logo já leva ao início (com o Grupo, só cabe a partir de 2xl). */}
          <Link
            to="/"
            className={`${navLinkClass} hidden 2xl:inline`}
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
          <Link
            to="/perfil"
            className={navLinkClass}
            activeProps={{ className: "text-foreground" }}
            aria-label="Perfil de gamer"
          >
            <UserIcon className="lg:hidden" />
            <span className="max-lg:hidden">Perfil</span>
          </Link>
          <Link
            to="/grupo"
            className={navLinkClass}
            activeProps={{ className: "text-foreground" }}
            aria-label="Grupo"
          >
            <UsersIcon className="lg:hidden" />
            <span className="max-lg:hidden">Grupo</span>
          </Link>
          <div className="ml-auto flex items-center">
            <PendingIndicator
              userId={userId}
              className="max-sm:h-8 max-sm:gap-0.5 max-sm:px-0.5 sm:mr-1"
            />
            <SoundToggle className="max-sm:size-8 sm:mr-2" />
            <Link
              to="/ajustes"
              aria-label={`Ajustes (${session.name})`}
              title={session.name}
              className="group mr-1 flex size-9 items-center justify-center sm:mr-3"
            >
              <ProfileAvatar
                avatar={session.avatar}
                className="size-8 group-hover:shadow-[0_0_0_2px_var(--foreground)] group-aria-[current=page]:shadow-[0_0_0_2px_var(--primary)]"
              />
            </Link>
            <StartSessionButton className="max-sm:mr-2 max-xl:px-2.5" />
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
      <SessionNoteDialog />
      <Toaster position="bottom-right" />
      <InstallAppToast />
    </div>
  );
}
