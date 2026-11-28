import { useOnline } from "./use-online";

/** Faixa sob o cabeçalho enquanto não há conexão: explica de onde vêm os dados e as escritas. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <output className="block border-t-(length:--rule) border-dashed border-muted bg-card">
      <p className="mx-auto max-w-6xl px-4 py-1.5 text-sm leading-5 text-muted-foreground">
        <span className="mr-2 display-xs text-foreground">Sem conexão</span>
        Mostrando o que já foi aberto neste aparelho. Sessões e timer ficam guardados e vão para o
        servidor quando a conexão voltar.
      </p>
    </output>
  );
}
