import { create } from "zustand";
import type { PlaySessionItem } from "@shared/sessions";

// Estado de UI do modal "Registrar sessão", para abri-lo de qualquer tela.
// Dados do servidor ficam no TanStack Query; aqui só o que é do cliente.

interface LogSessionDialogState {
  open: boolean;
  /** Jogo pré-selecionado ao registrar. */
  gameId: number | null;
  /** Sessão sendo editada (modo edição). */
  editing: PlaySessionItem | null;
  openNew: (gameId?: number) => void;
  openEdit: (session: PlaySessionItem) => void;
  close: () => void;
}

export const useLogSessionDialog = create<LogSessionDialogState>()((set) => ({
  open: false,
  gameId: null,
  editing: null,
  openNew: (gameId) => set({ open: true, gameId: gameId ?? null, editing: null }),
  openEdit: (session) => set({ open: true, gameId: session.gameId, editing: session }),
  close: () => set({ open: false }),
}));
