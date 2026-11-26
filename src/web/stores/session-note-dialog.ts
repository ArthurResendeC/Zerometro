import { create } from "zustand";

// Estado de UI do diálogo "Onde parei?", para abri-lo do toast do "Parei" e da página do jogo.

export interface SessionNoteTarget {
  /** A sessão a anotar; sem ela, a última sessão do jogo (`gameId`). */
  sessionId?: number;
  gameId?: number;
  gameName: string;
  /** Nota atual (vazia numa sessão sem nota). */
  note: string;
}

interface SessionNoteDialogState {
  target: SessionNoteTarget | null;
  openFor: (target: SessionNoteTarget) => void;
  close: () => void;
}

export const useSessionNoteDialog = create<SessionNoteDialogState>()((set) => ({
  target: null,
  openFor: (target) => set({ target }),
  close: () => set({ target: null }),
}));
