// Texto do toast de instalação para cada navegador/plataforma. Função pura (recebe o que precisa
// do `navigator`) para dar para testar com user agents reais.

export interface InstallGuide {
  title: string;
  description: string;
  steps: string;
}

export interface BrowserInfo {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

export function getInstallGuide({
  userAgent,
  platform,
  maxTouchPoints,
}: BrowserInfo): InstallGuide {
  // iPad com iPadOS 13+ se apresenta como Mac; o que entrega é ter tela de toque.
  const isIos =
    /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(userAgent);
  const isFirefox = /Firefox|FxiOS/i.test(userAgent);
  const isEdge = /Edg(e|A|iOS)?\//i.test(userAgent);
  const isChrome = /Chrome|CriOS/i.test(userAgent) && !isEdge && !isFirefox;
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS|FxiOS|Edg/i.test(userAgent);

  if (isIos) {
    return {
      title: "Zerômetro na Tela de Início",
      description: "Abra como app, em tela cheia, direto do ícone da chama.",
      steps: isSafari
        ? "Toque em Compartilhar e escolha Adicionar à Tela de Início."
        : "Toque em Compartilhar e procure Adicionar à Tela de Início. Se a opção não aparecer, abra esta página no Safari.",
    };
  }

  if (isAndroid && isFirefox) {
    return {
      title: "Instale o Zerômetro",
      description: "Abra como app, direto da tela inicial.",
      steps: "No menu do Firefox, toque em Instalar ou Adicionar à tela inicial.",
    };
  }

  if (isAndroid) {
    return {
      title: "Instale o Zerômetro",
      description: "Abra como app, direto da tela inicial.",
      steps: "Toque em Instalar ou, no menu do navegador, escolha Instalar app.",
    };
  }

  if (isSafari) {
    return {
      title: "Zerômetro no Dock",
      description: "Use como um app separado no Mac, com janela própria.",
      steps: "No Safari, vá em Arquivo > Adicionar ao Dock (ou Compartilhar > Adicionar ao Dock).",
    };
  }

  if (isFirefox) {
    return {
      title: "Instale o Zerômetro",
      description: "Use como um app separado, com janela própria.",
      steps:
        "O Firefox no computador nem sempre oferece a instalação. Se não aparecer no menu, abra esta página no Chrome, Edge ou Safari.",
    };
  }

  if (isChrome || isEdge) {
    return {
      title: "Instale o Zerômetro",
      description: "Use como um app separado, com janela própria e atalho na barra de tarefas.",
      steps: "Clique em Instalar ou no ícone de instalar na barra de endereço.",
    };
  }

  return {
    title: "Instale o Zerômetro",
    description: "Use como um app separado, direto do seu sistema.",
    steps: "Procure Instalar app ou Adicionar à tela inicial no menu do navegador.",
  };
}

/** Já está aberto como app instalado (janela própria ou tela cheia do iOS). */
export function isRunningAsApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
