import { describe, expect, test } from "bun:test";
import { getInstallGuide } from "./install-guide";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1",
  // iPadOS se apresenta como Mac.
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
};

const guide = (userAgent: string, platform = "Win32", maxTouchPoints = 0) =>
  getInstallGuide({ userAgent, platform, maxTouchPoints });

describe("getInstallGuide", () => {
  test("iPhone no Safari: Compartilhar > Adicionar à Tela de Início", () => {
    const { title, steps } = guide(UA.iphoneSafari, "iPhone", 5);
    expect(title).toContain("Tela de Início");
    expect(steps).toStartWith("Toque em Compartilhar e escolha");
  });

  test("iPhone fora do Safari sugere abrir no Safari", () => {
    expect(guide(UA.iphoneChrome, "iPhone", 5).steps).toContain("abra esta página no Safari");
  });

  test("iPad (que se diz Mac) é tratado como iOS pela tela de toque", () => {
    expect(guide(UA.ipadSafari, "MacIntel", 5).title).toContain("Tela de Início");
  });

  test("Safari no Mac: Adicionar ao Dock", () => {
    const { title, steps } = guide(UA.macSafari, "MacIntel", 0);
    expect(title).toContain("Dock");
    expect(steps).toContain("Arquivo > Adicionar ao Dock");
  });

  test("Android: Chrome pelo botão ou menu, Firefox pelo menu dele", () => {
    expect(guide(UA.androidChrome, "Linux armv8l", 5).steps).toContain("Instalar app");
    expect(guide(UA.androidFirefox, "Linux armv8l", 5).steps).toContain("menu do Firefox");
  });

  test("Chrome e Edge no computador: botão ou ícone da barra de endereço", () => {
    for (const userAgent of [UA.windowsChrome, UA.windowsEdge, UA.macChrome]) {
      expect(guide(userAgent, userAgent === UA.macChrome ? "MacIntel" : "Win32").steps).toContain(
        "barra de endereço",
      );
    }
  });

  test("Firefox no computador sugere outro navegador", () => {
    expect(guide(UA.windowsFirefox).steps).toContain("Chrome, Edge ou Safari");
  });

  test("navegador desconhecido cai no texto genérico", () => {
    expect(guide("Mozilla/5.0 (X11; Linux x86_64) Qualquer/1.0", "Linux x86_64").steps).toContain(
      "menu do navegador",
    );
  });
});
