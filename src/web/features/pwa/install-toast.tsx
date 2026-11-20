import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { CloseIcon, DownloadIcon, PixelFlame } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { type InstallGuide, getInstallGuide, isRunningAsApp } from "./install-guide";
import { promptInstall, useInstallPrompt } from "./install-prompt";

const TOAST_ID = "pwa-install";
export const INSTALL_TOAST_DISMISSED_KEY = "zerometro:install-toast-dismissed";
/** Espera a página assentar antes de oferecer (e dá tempo de o `beforeinstallprompt` chegar). */
const SHOW_DELAY_MS = 1500;

function wasDismissed() {
  try {
    return localStorage.getItem(INSTALL_TOAST_DISMISSED_KEY) === "true";
  } catch {
    // Sem storage não dá para lembrar do "Agora não": melhor não insistir a cada página.
    return true;
  }
}

/** Fecha e não mostra mais neste navegador. */
function dismissForGood() {
  try {
    localStorage.setItem(INSTALL_TOAST_DISMISSED_KEY, "true");
  } catch {
    // Storage bloqueado: só fecha.
  }
  toast.dismiss(TOAST_ID);
}

async function install() {
  try {
    await promptInstall();
  } finally {
    // Aceitando ou não, o evento já foi gasto; o navegador continua oferecendo pelo menu.
    dismissForGood();
  }
}

function InstallToastContent({ guide, canPrompt }: { guide: InstallGuide; canPrompt: boolean }) {
  return (
    <div className="flex gap-3">
      <PixelFlame className="mt-1 h-10 w-8" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {/* Herda a fonte pixel do título dos toasts (classNames.title do Toaster). */}
          <p className="pt-1">{guide.title}</p>
          <button
            type="button"
            aria-label="Fechar sugestão de instalação"
            onClick={dismissForGood}
            className="-mt-1 -mr-2 grid size-8 shrink-0 cursor-pointer place-items-center text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <CloseIcon />
          </button>
        </div>
        <p className="mt-1.5 font-sans text-sm leading-5 text-muted-foreground">
          {guide.description}
        </p>
        <p className="mt-1.5 font-sans text-sm leading-5">{guide.steps}</p>
        <div className="mt-3 flex flex-wrap items-center">
          {canPrompt && (
            <Button size="sm" onClick={() => void install()}>
              <DownloadIcon /> Instalar
            </Button>
          )}
          <Button size="sm" variant={canPrompt ? "ghost" : "secondary"} onClick={dismissForGood}>
            Agora não
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sugere instalar o app num toast na borda inferior, com o passo a passo do navegador atual.
 * No Chrome/Edge tem o botão "Instalar" (diálogo nativo); nos outros, só as instruções.
 * Não aparece rodando como app, depois de instalar nem depois de fechado.
 */
export function InstallAppToast() {
  const canPrompt = useInstallPrompt((state) => state.event !== null);
  const installed = useInstallPrompt((state) => state.installed);
  const guide = useMemo(() => getInstallGuide(navigator), []);

  useEffect(() => {
    if (installed) dismissForGood();
  }, [installed]);

  // Chama de novo quando o `beforeinstallprompt` chega: mesmo id, só atualiza o conteúdo.
  useEffect(() => {
    if (installed || isRunningAsApp() || wasDismissed()) return;
    const timer = window.setTimeout(() => {
      toast.custom(() => <InstallToastContent guide={guide} canPrompt={canPrompt} />, {
        id: TOAST_ID,
        duration: Infinity,
        position: "bottom-center",
        // Só fecha pelos botões, que lembram a escolha (arrastar fecharia sem lembrar).
        dismissible: false,
        classNames: { content: "min-w-0 flex-1" },
      });
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [canPrompt, guide, installed]);

  // Saindo do layout logado (logout), o toast não pode ir parar no Toaster da tela de login.
  useEffect(() => () => void toast.dismiss(TOAST_ID), []);

  return null;
}
