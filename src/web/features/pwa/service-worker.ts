function register() {
  navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
    console.error("[pwa] falha ao registrar o service worker", error);
  });
}

/**
 * Registra o service worker (src/web/public/sw.js), que mostra a página offline quando a rede cai.
 * Só em produção: em dev ele ficaria entre o navegador e o HMR do Bun.
 */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  // Depois do `load`, para não disputar banda com o carregamento da página.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
