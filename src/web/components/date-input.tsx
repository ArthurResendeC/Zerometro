import { useRef, useState } from "react";
import { z } from "zod";
import { isoDateSchema } from "@shared/dates";
import { CalendarIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { formatDate, parseDisplayDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const isIsoDate = (value: string) => isoDateSchema.safeParse(value).success;

/** Só dígitos, com as barras no lugar: "1911" → "19/11", "19112026" → "19/11/2026". */
function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
}

const toText = (value: string) => (isIsoDate(value) ? formatDate(value) : value);
const toValue = (text: string) => (text === "" ? "" : (parseDisplayDate(text) ?? text));

interface DateInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type" | "min" | "max"
> {
  /** Data em YYYY-MM-DD, "" (vazio) ou o texto de uma digitação incompleta. */
  value: string;
  /**
   * Recebe YYYY-MM-DD quando a data está completa e existe, "" quando o campo foi esvaziado e,
   * no meio da digitação, o próprio texto (que `dateField` acusa como inválido).
   */
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}

/**
 * Campo de data sempre em dd/mm/aaaa. O `<input type="date">` segue o idioma do navegador
 * (mm/dd/aaaa num Chrome em inglês), então ele fica escondido e só serve de calendário.
 */
export function DateInput({ value, onChange, min, max, className, ...props }: DateInputProps) {
  const [text, setText] = useState(() => toText(value));
  const [synced, setSynced] = useState(value);
  const picker = useRef<HTMLInputElement>(null);

  // O valor mudou por fora (botões Hoje/Ontem, reset do formulário): mostra a nova data.
  if (value !== synced) {
    setSynced(value);
    if (value !== toValue(text)) setText(toText(value));
  }

  const commit = (nextText: string) => {
    const next = toValue(nextText);
    setText(nextText);
    setSynced(next);
    onChange(next);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={text}
        onChange={(e) => commit(maskDate(e.target.value))}
        className="pr-12 tabular-nums"
      />
      <button
        type="button"
        onClick={() => {
          // Navegadores sem showPicker (Safari antigo) ficam só com a digitação.
          try {
            picker.current?.showPicker();
          } catch {
            picker.current?.parentElement?.querySelector("input")?.focus();
          }
        }}
        className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
        aria-label="Abrir calendário"
        tabIndex={-1}
      >
        <CalendarIcon />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        max={max}
        value={isIsoDate(value) ? value : ""}
        onChange={(e) => commit(e.target.value ? formatDate(e.target.value) : "")}
        className="pointer-events-none absolute bottom-0 left-1 h-0 w-0 opacity-0"
      />
    </div>
  );
}

/**
 * Validação de um campo `DateInput` (mensagens em dd/mm/aaaa; a API fala YYYY-MM-DD).
 * `max` costuma ser hoje; `optional` aceita o campo vazio.
 */
export function dateField({ max, optional = false }: { max?: string; optional?: boolean } = {}) {
  return z.string().superRefine((value, ctx) => {
    if (value === "") {
      if (!optional) ctx.addIssue({ code: "custom", message: "Informe a data" });
    } else if (!isIsoDate(value)) {
      ctx.addIssue({ code: "custom", message: "Data inválida: use dd/mm/aaaa" });
    } else if (max && value > max) {
      ctx.addIssue({ code: "custom", message: `A data não pode passar de ${formatDate(max)}` });
    }
  });
}
