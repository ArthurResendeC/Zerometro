// Dinheiro em reais, guardado em centavos (inteiro) para não somar com erro de ponto flutuante.

/** Até R$ 99.999,99 por jogo. */
export const MAX_PRICE_CENTS = 9_999_999;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 5990 → "R$ 59,90" (com espaço normal, para não quebrar a busca e os testes). */
export function formatBrl(cents: number): string {
  return brl.format(cents / 100).replace(/\s/u, " ");
}

/**
 * Preço digitado → centavos: "59,90", "59.90", "R$ 1.234,56", "60" e "0". A vírgula é sempre a
 * dos centavos; um ponto só é dos centavos quando não há vírgula e vem seguido de 1 ou 2
 * dígitos no fim ("59.9"). null se não for um valor válido.
 */
export function parseBrl(text: string): number | null {
  const clean = text.replace(/r\$/iu, "").replace(/\s/gu, "");
  if (!/^\d[\d.,]*$/u.test(clean)) return null;
  let normalized: string;
  if (clean.includes(",")) {
    if ((clean.match(/,/gu) ?? []).length > 1) return null;
    normalized = clean.replaceAll(".", "").replace(",", ".");
  } else if (/\.\d{1,2}$/u.test(clean) && (clean.match(/\./gu) ?? []).length === 1) {
    normalized = clean;
  } else {
    normalized = clean.replaceAll(".", "");
  }
  if (!/^\d+(\.\d{1,2})?$/u.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents <= MAX_PRICE_CENTS ? cents : null;
}

/** 59,90 (em reais, como o MCP recebe) → 5990. */
export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}
