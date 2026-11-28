// Prints do README: `mise run readme:shots` (todos) ou `mise run readme:shots ajustes jogo`.
//
// Sobe um demo novo num diretório temporário (o mesmo seed do `mise run demo`), liga uma conta
// Steam fictícia, roda o servidor numa porta livre, captura as telas num Chromium headless (via
// CDP) e grava em docs/readme/ com a moldura dos prints: borda #7a7396 de 4px com os cantos em
// degrau, sombra preta deslocada 4px, margem transparente e PNG com paleta.
//
// Precisa de um Chromium: o do Playwright (~/.cache/ms-playwright, `bunx playwright install
// chromium-headless-shell`), um `chromium`/`google-chrome` no PATH, ou CHROME_PATH. O print
// "adicionar" busca no IGDB de verdade, então precisa de IGDB_CLIENT_ID/SECRET (sem eles, é
// pulado). O banner não é print: fica de fora.

import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { INSTALL_TOAST_DISMISSED_KEY } from "../src/web/features/pwa/install-toast";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "docs/readme");
const BASE_URL = "http://localhost";

// ---------------------------------------------------------------------------------------------
// As telas

interface Shot {
  /** Arquivo em docs/readme/ (sem .png). */
  name: string;
  /** Precisa do IGDB de verdade (busca ao vivo). */
  needsIgdb?: boolean;
  capture: (page: Page) => Promise<Capture>;
}

/** Imagens lado a lado (uma moldura cada) e a escala da moldura (2 nas telas de celular). */
interface Capture {
  images: Buffer[];
  scale: number;
}

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, scale: 2, mobile: true };

/** Elden Ring e Celeste no demo (ids do IGDB). */
const ELDEN_RING = 119133;
const CELESTE = 26226;

const shots: Shot[] = [
  {
    name: "inicio",
    capture: async (page) => single(await page.shoot("/", DESKTOP, { fullPage: true })),
  },
  {
    name: "estatisticas",
    capture: async (page) => single(await page.shoot("/estatisticas", DESKTOP, { fullPage: true })),
  },
  {
    name: "perfil",
    capture: async (page) => single(await page.shoot("/perfil", DESKTOP, { fullPage: true })),
  },
  {
    name: "jogo-sobre",
    // Até as miniaturas dos vídeos.
    capture: async (page) =>
      single(
        await page.shoot(`/jogo/${ELDEN_RING}?aba=sobre`, DESKTOP, {
          cropBelow: `[...document.querySelectorAll("h2")].find(h => h.textContent.trim() === "Vídeos")?.closest("section")`,
          cropPadding: 1,
        }),
      ),
  },
  {
    name: "biblioteca",
    // Duas fileiras de cartuchos.
    capture: async (page) =>
      single(
        await page.shoot("/biblioteca", DESKTOP, {
          cropBelow: `document.querySelector("main .grid")?.children[9]`,
          cropPadding: 19,
        }),
      ),
  },
  {
    name: "jogo",
    // Até o fim dos objetivos (as sessões e os detalhes ficam de fora).
    capture: async (page) =>
      single(
        await page.shoot(`/jogo/${CELESTE}?aba=sessoes`, DESKTOP, {
          cropBelow: `[...document.querySelectorAll("p")].find(p => p.textContent.includes("Alvo 1 vira uma caixinha"))?.closest(".pixel-frame")`,
        }),
      ),
  },
  {
    name: "conquistas",
    // Até aparecerem secretas borradas.
    capture: async (page) =>
      single(await page.shoot(`/jogo/${CELESTE}?aba=conquistas`, DESKTOP, { maxHeight: 2268 })),
  },
  {
    name: "registrar-sessao",
    capture: async (page) =>
      single(
        await page.shoot("/", DESKTOP, {
          prepare: async () => {
            await page.click(`[aria-label="Registrar sessão"]`);
            await page.wait(800);
            await page.fill(`[role=dialog] input[inputmode=numeric]`, ["1", "30"]);
            await page.clickText("[role=dialog] button", "Ontem");
            await page.fill(`[role=dialog] textarea`, ["Derrotei a Rennala!"]);
          },
        }),
      ),
  },
  {
    name: "adicionar",
    needsIgdb: true,
    capture: async (page) =>
      single(
        await page.shoot("/adicionar", DESKTOP, {
          prepare: async () => {
            await page.fill(`main input[type=search], main input`, ["hollow knight"]);
            await page.wait(3000);
          },
          cropBelow: `document.querySelector("main ul")`,
          cropPadding: 28,
        }),
      ),
  },
  {
    name: "celular",
    capture: async (page) => ({
      images: [await page.shoot("/", PHONE), await page.shoot("/biblioteca", PHONE)],
      scale: 2,
    }),
  },
  {
    name: "entrar",
    capture: async (page) =>
      single(
        await page.shoot("/entrar", DESKTOP, {
          loggedOut: true,
          // Um amigo do demo; a senha vira pontinhos.
          prepare: () => page.fill("#handle, #password", ["bia", "x".repeat(10)]),
        }),
      ),
  },
  {
    name: "grupo",
    capture: async (page) =>
      single(await page.shoot("/grupo", { width: 1280, height: 800 }, { fullPage: true })),
  },
  {
    name: "amigo",
    capture: async (page) =>
      single(
        await page.shoot("/amigo/bia", DESKTOP, {
          cropBelow: `[...document.querySelectorAll("h2")].find(h => h.textContent.trim() === "Zerou por último")?.closest("section")`,
        }),
      ),
  },
  {
    name: "ajustes",
    capture: async (page) =>
      single(
        await page.shoot(
          "/ajustes",
          { width: 720, height: 800 },
          {
            // Até o "Aparecer no grupo": sua conta, as pessoas (admin) e o grupo.
            cropBelow: `[...document.querySelectorAll("label")].find(l => l.textContent.includes("Aparecer no grupo"))?.closest("[data-slot=card]")`,
          },
        ),
      ),
  },
];

const single = (image: Buffer): Capture => ({ images: [image], scale: 1 });

// ---------------------------------------------------------------------------------------------
// Moldura

/**
 * Moldura dos prints: margem transparente (16 em cima/à esquerda, 20 depois da sombra), borda
 * #7a7396 de 4px com os cantos recortados (4×4) e sombra preta com o mesmo recorte, deslocada
 * 4px. Tudo vezes `scale`. Várias imagens ficam lado a lado, a 32px uma da outra.
 */
async function frame(images: Buffer[], scale: number): Promise<Buffer> {
  const [M, B, SH, END, GAP] = [16, 4, 4, 20, 32].map((n) => n * scale) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const sizes = await Promise.all(images.map((img) => sharp(img).metadata()));
  const outer = sizes.map((s) => ({ w: s.width! + 2 * B, h: s.height! + 2 * B }));
  const height = Math.max(...outer.map((o) => o.h));
  const width = outer.reduce((sum, o) => sum + o.w, 0) + GAP * (outer.length - 1);
  const notched = (x: number, y: number, w: number, h: number, fill: string) =>
    `<path fill="${fill}" d="M${x + B},${y} h${w - 2 * B} v${B} h${B} v${h - 2 * B} h${-B} v${B} h${-(w - 2 * B)} v${-B} h${-B} v${-(h - 2 * B)} h${B} z"/>`;

  let x = M;
  const shapes: string[] = [];
  const layers: sharp.OverlayOptions[] = [];
  for (const [i, o] of outer.entries()) {
    shapes.push(notched(x + SH, M + SH, o.w, o.h, "#000000"), notched(x, M, o.w, o.h, "#7a7396"));
    layers.push({ input: images[i]!, left: x + B, top: M + B });
    x += o.w + GAP;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${M + width + SH + END}" height="${M + height + SH + END}" shape-rendering="crispEdges">${shapes.join("")}</svg>`;
  return sharp(Buffer.from(svg))
    .composite(layers)
    .png({ palette: true, colours: 256, effort: 10 })
    .toBuffer();
}

// ---------------------------------------------------------------------------------------------
// Navegador (Chrome DevTools Protocol)

interface Viewport {
  width: number;
  height: number;
  scale?: number;
  mobile?: boolean;
}

interface ShootOptions {
  /** A página inteira, em vez da janela. */
  fullPage?: boolean;
  /** Expressão JS com o elemento onde o print termina, `cropPadding` px abaixo dele (padrão 20). */
  cropBelow?: string;
  cropPadding?: number;
  maxHeight?: number;
  loggedOut?: boolean;
  prepare?: () => Promise<unknown>;
}

class Page {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  readonly errors: string[] = [];

  private constructor(
    private ws: WebSocket,
    private origin: string,
    private cookie: { name: string; value: string },
  ) {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.errors.push(msg.params.exceptionDetails.exception?.description ?? "exceção");
      }
    });
  }

  static async connect(debuggerUrl: string, origin: string, cookie: Page["cookie"]) {
    const ws = new WebSocket(debuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const page = new Page(ws, origin, cookie);
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    return page;
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.text}`);
    return result?.value as T;
  }

  click = (selector: string) =>
    this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

  clickText = (selector: string, text: string) =>
    this.evaluate(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`,
    );

  /** Preenche os campos (controlados pelo React) que casam com o seletor, na ordem. */
  fill = (selector: string, values: string[]) =>
    this.evaluate(`(() => {
      const fields = [...document.querySelectorAll(${JSON.stringify(selector)})];
      ${JSON.stringify(values)}.forEach((value, i) => {
        const el = fields[i];
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    })()`);

  private async viewport({ width, height, scale = 1, mobile = false }: Viewport) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      mobile,
    });
  }

  async shoot(path: string, viewport: Viewport, options: ShootOptions = {}): Promise<Buffer> {
    // Cada print começa do zero: o app guarda a sessão no aparelho (offline), e a do print sem
    // login não pode vazar para os outros.
    await this.send("Storage.clearDataForOrigin", { origin: this.origin, storageTypes: "all" });
    await this.send("Network.clearBrowserCookies");
    if (!options.loggedOut) {
      await this.send("Network.setCookie", { ...this.cookie, url: this.origin, httpOnly: true });
    }
    await this.viewport(viewport);
    // Sem o convite para instalar o app por cima da tela.
    await this.send("Page.navigate", { url: `${this.origin}/` });
    await this.wait(300);
    await this.evaluate(
      `localStorage.setItem(${JSON.stringify(INSTALL_TOAST_DISMISSED_KEY)}, "true")`,
    );
    await this.send("Page.navigate", { url: `${this.origin}${path}` });
    await this.wait(4000);
    await options.prepare?.();
    // Sem o anel de foco do último campo preenchido.
    await this.evaluate("document.activeElement?.blur()");
    await this.wait(800);

    let height = viewport.height;
    if (options.fullPage || options.cropBelow || options.maxHeight) {
      const { cssContentSize } = await this.send("Page.getLayoutMetrics");
      height = Math.ceil(cssContentSize.height);
    }
    if (options.cropBelow) {
      const bottom = await this.evaluate<number | null>(
        `(() => { const el = ${options.cropBelow}; return el ? Math.ceil(el.getBoundingClientRect().bottom + scrollY + ${options.cropPadding ?? 20}) : null; })()`,
      );
      if (bottom === null) throw new Error(`${path}: não achei onde cortar (${options.cropBelow})`);
      height = Math.min(height, bottom);
    }
    if (options.maxHeight) height = Math.min(height, options.maxHeight);

    // A janela do tamanho do print: o cabeçalho fixo fica só no topo.
    await this.viewport({ ...viewport, height });
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: height - 1 });
    await this.wait(1200);
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: viewport.width, height, scale: 1 },
    });
    return Buffer.from(data, "base64");
  }

  close() {
    this.ws.close();
  }
}

function findChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), ".cache/ms-playwright");
  if (existsSync(cache)) {
    const shells = readdirSync(cache)
      .filter((dir) => dir.startsWith("chromium_headless_shell-"))
      .toSorted()
      .toReversed();
    for (const dir of shells) {
      const bin = join(cache, dir, "chrome-headless-shell-linux64/chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  }
  for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
    const bin = Bun.which(name);
    if (bin) return bin;
  }
  throw new Error(
    "Nenhum Chromium encontrado: rode `bunx playwright install chromium-headless-shell` ou defina CHROME_PATH",
  );
}

async function launchChrome(profileDir: string) {
  const chrome = Bun.spawn(
    [
      findChrome(),
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  // A porta escolhida pelo Chrome aparece neste arquivo.
  const portFile = join(profileDir, "DevToolsActivePort");
  // Espera o arquivo aparecer (até 10s): uma tentativa depois da outra, de propósito.
  // oxlint-disable-next-line no-await-in-loop
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await Bun.sleep(100);
  const port = (await Bun.file(portFile).text()).split("\n")[0];
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("O Chrome abriu sem nenhuma aba");
  return { chrome, debuggerUrl: page.webSocketDebuggerUrl };
}

// ---------------------------------------------------------------------------------------------
// Demo e servidor

/** Conta Steam fictícia (sem pessoa real), já "sincronizada": o app não chama a Steam. */
function addFakeSteam(dbPath: string) {
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  const upsert = db.query(
    "insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
  );
  upsert.run(
    "steam:profile:owner",
    JSON.stringify({
      steamId: "76561190000000000",
      name: "zerometro-demo",
      avatarUrl: "/icons/icon-192.png",
      profileUrl: "https://steamcommunity.com/",
      linkedAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
    }),
  );
  // Recém-sincronizado: dentro do intervalo, a sincronização automática não roda.
  upsert.run("steam:auto:owner", JSON.stringify({ lastRunAt: now, lastError: null }));
  db.query(
    "update library_entries set steam_minutes = 860, steam_synced_at = ? where game_id = (select id from games where igdb_id = ?)",
  ).run(now, CELESTE);
  db.close();
}

async function run(cmd: string[], env: Record<string, string>) {
  const proc = Bun.spawn(cmd, { cwd: ROOT, env: { ...process.env, ...env }, stdout: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(`Falhou: ${cmd.join(" ")}`);
}

async function startServer(env: Record<string, string>, port: number) {
  const server = Bun.spawn(["bun", "src/server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "development" },
    stdout: "ignore",
    stderr: "pipe",
  });
  // Espera o servidor responder (até 20s): uma tentativa depois da outra, de propósito.
  for (let i = 0; i < 100; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const ok = await fetch(`${BASE_URL}:${port}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return server;
    if (server.exitCode !== null) break;
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(200);
  }
  server.kill();
  throw new Error(`O servidor não subiu: ${await new Response(server.stderr).text()}`);
}

/** Uma porta livre: o sistema escolhe, e a gente devolve. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  void probe.stop(true);
  return port!;
}

// ---------------------------------------------------------------------------------------------

const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !shots.some((s) => s.name === name));
if (unknown.length > 0) {
  console.error(`Prints desconhecidos: ${unknown.join(", ")}`);
  console.error(`Disponíveis: ${shots.map((s) => s.name).join(", ")}`);
  process.exit(1);
}
const hasIgdb = Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
const selected = shots.filter((s) => wanted.length === 0 || wanted.includes(s.name));

const workDir = mkdtempSync(join(tmpdir(), "zerometro-readme-"));
// O seed só aceita um banco com "demo" no nome.
const dbPath = join(workDir, "readme-demo.db");
const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const port = freePort();
const origin = `${BASE_URL}:${port}`;
const env = { DATABASE_PATH: dbPath, ZEROMETRO_TOKEN: token, PUBLIC_URL: origin };

let server: ReturnType<typeof Bun.spawn> | undefined;
let chrome: ReturnType<typeof Bun.spawn> | undefined;
let page: Page | undefined;
try {
  console.log("Demo novo…");
  await run(["bun", "scripts/seed-demo.ts"], env);
  addFakeSteam(dbPath);
  server = await startServer(env, port);

  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const [name, value] = (login.headers.getSetCookie()[0] ?? "").split(";")[0]!.split("=");
  if (!login.ok || !name || !value) throw new Error(`Login falhou (${login.status})`);

  const browser = await launchChrome(join(workDir, "chrome"));
  chrome = browser.chrome;
  page = await Page.connect(browser.debuggerUrl, origin, { name, value });

  for (const shot of selected) {
    if (shot.needsIgdb && !hasIgdb) {
      console.warn(`${shot.name}: pulado (precisa de IGDB_CLIENT_ID e IGDB_CLIENT_SECRET)`);
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop
    const { images, scale } = await shot.capture(page);
    // oxlint-disable-next-line no-await-in-loop
    const png = await frame(images, scale);
    // oxlint-disable-next-line no-await-in-loop
    await Bun.write(join(OUT_DIR, `${shot.name}.png`), png);
    // oxlint-disable-next-line no-await-in-loop
    const { width, height } = await sharp(png).metadata();
    console.log(`${shot.name}.png ${width}×${height}`);
  }
  if (page.errors.length > 0) {
    console.error(`Erros de runtime na página:\n${page.errors.join("\n")}`);
    process.exitCode = 1;
  }
} finally {
  page?.close();
  chrome?.kill();
  server?.kill();
  await Promise.all([chrome?.exited, server?.exited]);
  rmSync(workDir, { recursive: true, force: true });
}
