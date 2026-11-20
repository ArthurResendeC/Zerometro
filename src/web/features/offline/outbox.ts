import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { OutboxItem } from "./outbox-core";

// Fila de operações feitas sem conexão (ou enquanto havia algo na fila), guardada no
// localStorage deste aparelho até o servidor aceitar. Ver ./outbox-core.ts e ./sync.ts.

export const OUTBOX_STORAGE_KEY = "zerometro:outbox";

interface OutboxState {
  items: OutboxItem[];
  enqueue: (item: OutboxItem) => void;
  /** Saiu da fila: o servidor aceitou (ou já tinha feito). */
  remove: (id: string) => void;
  markFailed: (id: string, error: string) => void;
  /** Tira da fila sem enviar, junto com o que depende dele (o stop de um start descartado). */
  discard: (id: string) => void;
}

const withoutItemAndDependents = (items: OutboxItem[], id: string) =>
  items.filter((item) => item.id !== id && item.dependsOn !== id);

export const useOutbox = create<OutboxState>()(
  persist(
    (set) => ({
      items: [],
      enqueue: (item) => set((state) => ({ items: [...state.items, item] })),
      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      markFailed: (id, error) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, status: "failed" as const, error } : item,
          ),
        })),
      discard: (id) => set((state) => ({ items: withoutItemAndDependents(state.items, id) })),
    }),
    {
      name: OUTBOX_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ items }) => ({ items }),
      // Editado à mão ou corrompido: melhor uma fila vazia do que quebrar o app.
      merge: (persisted, current) => {
        const items = (persisted as { items?: unknown } | undefined)?.items;
        return { ...current, items: Array.isArray(items) ? (items as OutboxItem[]) : [] };
      },
    },
  ),
);

/** Itens do usuário logado (a fila é do aparelho, mas cada um só vê e envia os seus). */
export function useUserOutbox(userId: string | undefined) {
  const items = useOutbox((state) => state.items);
  return userId ? items.filter((item) => item.userId === userId) : [];
}

export function userItems(userId: string) {
  return useOutbox.getState().items.filter((item) => item.userId === userId);
}
