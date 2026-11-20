import { create } from "zustand";

/** Evento do Chrome/Edge que permite abrir o diálogo nativo de instalação quando quisermos. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

interface InstallPromptState {
  /** Guardado até o clique em "Instalar"; só serve uma vez. */
  event: BeforeInstallPromptEvent | null;
  /** O app acabou de ser instalado nesta aba. */
  installed: boolean;
}

export const useInstallPrompt = create<InstallPromptState>()(() => ({
  event: null,
  installed: false,
}));

/**
 * Escuta os eventos de instalação desde o boot (main.tsx): o Chrome dispara o
 * `beforeinstallprompt` cedo, antes de o layout logado (onde fica o toast) montar.
 */
export function listenForInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Sem o mini-infobar do Chrome no Android: quem oferece a instalação é o nosso toast.
    event.preventDefault();
    useInstallPrompt.setState({ event: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    useInstallPrompt.setState({ event: null, installed: true });
  });
}

/** Abre o diálogo nativo; devolve se a pessoa aceitou. */
export async function promptInstall() {
  const { event } = useInstallPrompt.getState();
  if (!event) return false;
  // O evento só pode ser usado uma vez, aceitando ou não.
  useInstallPrompt.setState({ event: null });
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
