import { useDebouncedValue } from "@tanstack/react-pacer";
import { useEffect, useState } from "react";
import { SearchIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  /** Valor confirmado (ex.: o search param da URL). */
  value: string;
  /** Chamado com o valor já com debounce. */
  onChange: (value: string) => void;
  placeholder?: string;
  wait?: number;
  className?: string;
}

/** Campo de busca que digita livre e só propaga o valor depois de uma pausa. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  wait = 300,
  className,
}: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const [debounced] = useDebouncedValue(draft, { wait });

  // Sincroniza quando o valor externo muda (ex.: voltar no navegador).
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage ao valor com debounce
  }, [debounced]);

  return (
    <div className={cn("relative", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className="pl-10"
      />
    </div>
  );
}
