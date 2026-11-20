import type { ReactNode } from "react";
import { ExternalIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Link para outro site: abre em outra aba, com o ícone de "sai do site" e aviso para leitor de tela. */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      {children}
      <ExternalIcon className="size-2.5 opacity-70" />
      <span className="sr-only">(abre em outra aba)</span>
    </a>
  );
}
