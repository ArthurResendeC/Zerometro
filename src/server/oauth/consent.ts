// A página que aparece quando um conector (ex.: o Claude) pede acesso ao Zerômetro: quem pede,
// para onde a resposta vai e o @apelido e a senha do perfil que está aprovando (o admin também
// pode usar o ZEROMETRO_TOKEN como senha).
// Renderizada no servidor, sem JavaScript nem nada externo, com CSP fechado.
//
// Portado do my-scratchpad (https://github.com/Levieber/my-scratchpad, src/mcp/oauth/, MIT).

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** Cabeçalhos da página: nada carrega, nada a enquadra, o form só posta aqui e para o cliente. */
export const consentHeaders = (redirectUri: string): Record<string, string> => ({
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    // O navegador confere o form-action também contra o redirect que responde ao form.
    `form-action 'self' ${new URL(redirectUri).origin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; "),
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

// As cores do tema do app (src/web/styles.css), claro e escuro, com a borda e a sombra em pixel.
const STYLE = `
  :root { --bg: #f6efdf; --fg: #1c1a29; --muted: #5c5670; --card: #fffaf0; --border: #6e6785; --primary: #b34700; --on-primary: #fff; --danger: #c0182e; --shadow: #1c1a2933; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f0e17; --fg: #f4ecdc; --muted: #a39cb8; --card: #1c1a29; --border: #7a7396; --primary: #ff7a1a; --on-primary: #1a0d00; --danger: #ff5d6c; --shadow: #00000080; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 1rem; background: var(--bg); color: var(--fg); font: 1rem/1.5 system-ui, sans-serif; }
  main { width: 100%; max-width: 26rem; background: var(--card); border: 4px solid var(--border); box-shadow: 8px 8px 0 var(--shadow); padding: 1.5rem; }
  h1 { font: 700 1.25rem/1.3 ui-monospace, monospace; margin: 0 0 0.75rem; }
  h1 span { color: var(--primary); }
  p { margin: 0 0 1rem; color: var(--muted); }
  strong { color: var(--fg); }
  label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
  input[type=password], input[type=text] { width: 100%; font: inherit; padding: 0.5rem 0.75rem; border: 2px solid var(--border); background: var(--bg); color: var(--fg); }
  .field { margin-bottom: 0.75rem; }
  .hint { font-size: 0.875rem; margin: 0.25rem 0 0; }
  input[type=password]:focus, input[type=text]:focus { outline: 2px solid var(--primary); outline-offset: 2px; }
  .error { color: var(--danger); margin: 0.5rem 0 0; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
  button { flex: 1; font: inherit; font-weight: 600; min-height: 2.75rem; border: 2px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
  button[value=allow] { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
`;

const shell = (title: string, body: string) => `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${title}</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>`;

export function consentPage({
  clientName,
  redirectUri,
  params,
  handle = "",
  error,
}: {
  clientName: string | undefined;
  redirectUri: string;
  /** O pedido de autorização, levado sem mudanças pelo form até o POST. */
  params: Record<string, string>;
  /** O @apelido já digitado (numa nova tentativa). */
  handle?: string;
  error?: string;
}): string {
  const who = escapeHtml(clientName?.trim() || "Um aplicativo");
  const where = escapeHtml(new URL(redirectUri).host);
  const hidden = Object.entries(params)
    .map(
      ([name, value]) =>
        `      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("\n");
  const invalid = error ? ' aria-invalid="true" aria-describedby="error"' : "";
  return shell(
    "Conectar ao Zerômetro",
    `    <h1>Conectar ao Zer<span>ô</span>metro?</h1>
    <p><strong>${who}</strong> quer ver e alterar a sua biblioteca, as suas sessões, o timer e as estatísticas. Se você autorizar, volta para <strong>${where}</strong>.</p>
    <form method="post" action="/authorize">
${hidden}
      <div class="field">
        <label for="handle">@apelido</label>
        <input id="handle" name="handle" type="text" value="${escapeHtml(handle)}" autocomplete="username" autocapitalize="none" spellcheck="false"${handle ? "" : " autofocus"}${invalid}>
      </div>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password"${handle ? " autofocus" : ""}${invalid}>
      <p class="hint">Admin sem senha? Deixe o @apelido vazio e use o token da instância.</p>
      ${error ? `<p class="error" id="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <div class="actions">
        <button type="submit" name="decision" value="deny">Cancelar</button>
        <button type="submit" name="decision" value="allow">Autorizar</button>
      </div>
    </form>`,
  );
}

/** Um pedido que não pode voltar ao cliente (cliente desconhecido, redirect não registrado). */
export const errorPage = (message: string) =>
  shell(
    "Zerômetro",
    `    <h1>Não deu para conectar</h1>
    <p>${escapeHtml(message)}</p>`,
  );
