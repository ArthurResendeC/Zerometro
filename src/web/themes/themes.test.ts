import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { themeIds, themes } from "@shared/themes";

// Contrato de temas (docs/gamificacao/temas-contrato.md §6): todo tema do registro tem CSS
// importado, define todas as cores em cada modo que declara e passa no contraste mínimo.

const WEB = join(import.meta.dir, "..");
const baseCss = readFileSync(join(WEB, "styles.css"), "utf8");

/** Declarações (--nome: valor) do primeiro bloco cujo seletor é exatamente `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return new Map();
  const body = css.slice(start + selector.length + 2, css.indexOf("\n}", start));
  const decls = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) decls.set(m[1]!, m[2]!.trim());
  return decls;
}

/** Tokens de cor: os do modo escuro do tema base. */
const colorTokens = [...block(baseCss, '[data-mode="dark"]').keys()];

function cssFor(id: string): string {
  return id === "cartucho" ? baseCss : readFileSync(join(WEB, "themes", `${id}.css`), "utf8");
}

function colors(id: string, mode: "dark" | "light"): Map<string, string> {
  if (id === "cartucho") return block(baseCss, mode === "dark" ? '[data-mode="dark"]' : ":root");
  return block(cssFor(id), `:root[data-theme="${id}"][data-mode="${mode}"]`);
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? [...n].map((c) => c + c).join("") : n;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Pares texto/fundo que aparecem na interface. */
function textPairs(c: Map<string, string>): [string, string][] {
  const pairs: [string, string][] = [
    ["foreground", "background"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["card-foreground", "card"],
    ["popover-foreground", "popover"],
  ];
  for (const token of c.keys()) {
    const base = token.slice(2);
    if (c.has(`${token}-foreground`)) pairs.push([`${base}-foreground`, base]);
  }
  return pairs;
}

test("há tokens de cor no tema base", () => {
  expect(colorTokens.length).toBeGreaterThan(40);
});

describe.each([...themeIds])("tema %s", (id) => {
  const def = themes[id];

  test("o CSS existe e está importado no styles.css", () => {
    if (id === "cartucho") return;
    expect(baseCss).toContain(`@import "./themes/${id}.css";`);
    expect(cssFor(id)).toContain(`:root[data-theme="${id}"]`);
  });

  test.each([...def.modes])("define todas as cores no modo %s", (mode) => {
    const defined = colors(id, mode);
    const missing = colorTokens.filter((token) => !defined.has(token));
    expect(missing).toEqual([]);
  });

  test.each([...def.modes])("contraste de texto de pelo menos 4.5:1 no modo %s", (mode) => {
    const c = colors(id, mode);
    const failures = textPairs(c)
      .map(([fg, bg]) => {
        const [a, b] = [c.get(`--${fg}`)!, c.get(`--${bg}`)!];
        return /^#[\da-f]{3,6}$/i.test(a) && /^#[\da-f]{3,6}$/i.test(b)
          ? { pair: `${fg} / ${bg}`, ratio: Math.round(contrast(a, b) * 100) / 100 }
          : null;
      })
      .filter((r) => r !== null && r.ratio < 4.5);
    expect(failures).toEqual([]);
  });

  test.each([...def.modes])("cores de destaque legíveis como texto no modo %s", (mode) => {
    // primary, info, destructive e coin também viram texto (avisos, timer, links, saldo) no
    // fundo da página e dos cards. Exceções anteriores a este teste: o vermelho do Ladrão
    // Fantasma (a identidade dele) e a moeda do Cartucho claro (modo que ainda não se escolhe).
    const known = new Set(["ladrao-fantasma:primary", "cartucho:coin"]);
    const c = colors(id, mode);
    const failures = ["primary", "info", "destructive", "coin"]
      .filter((token) => !known.has(`${id}:${token}`))
      .flatMap((token) =>
        ["background", "card"].map((bg) => ({
          pair: `${token} / ${bg}`,
          ratio: Math.round(contrast(c.get(`--${token}`)!, c.get(`--${bg}`)!) * 100) / 100,
        })),
      )
      .filter((r) => r.ratio < 4.5);
    expect(failures).toEqual([]);
  });

  test("tem cor da barra do navegador em cada modo", () => {
    for (const mode of def.modes) expect(def.themeColor[mode]).toMatch(/^#[\da-f]{6}$/i);
  });
});
