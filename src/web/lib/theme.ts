// Tema ativo: lido dos atributos do <html> (data-theme, data-mode), que o index.html define.
// Contrato: docs/gamificacao/temas-contrato.md.

export type ThemeMode = "dark" | "light";

/** Modo (claro/escuro) do tema ativo, para o que não lê o CSS (ex.: o sonner). */
export function currentMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.mode === "light" ? "light" : "dark";
}
