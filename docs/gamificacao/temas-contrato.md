# Contrato de temas

Plano para o Zerômetro aceitar temas comprados na loja: retrô, modernos e inspirados em jogos icônicos.
O ponto de partida é o `src/web/styles.css` atual, na "Direção A · Cartucho NES".

## Decisões já tomadas (economia)

- Moedas contam **a partir do cadastro** de cada usuário. Os registros começaram agora, então o histórico
  desde o cadastro vale, e ninguém sai muito na frente.
- O que é anterior ao cadastro não rende moeda. Vira **insígnias** (por exemplo, Platinador Veterano para
  quem tem muitos jogos com 100%) e um **bônus simbólico único** para quem organizou a biblioteca antiga
  (conclusões com data, Steam sincronizada).
- O avatar fica para depois. O foco agora são os temas.

## 1. O que é um tema

Um tema é uma **skin** com até 8 camadas. Só a primeira é obrigatória.

| #   | Camada                                   | Onde vive                                               | Obrigatória |
| --- | ---------------------------------------- | ------------------------------------------------------- | ----------- |
| 1   | Cores                                    | CSS: `[data-theme="x"]`                                 | sim         |
| 2   | Tipografia                               | CSS (tokens) e `@fontsource` sob demanda                | não (herda) |
| 3   | Forma (moldura, raio, sombra, bisel)     | CSS (tokens)                                            | não (herda) |
| 4   | Textura (fundo, overlay, cursor de menu) | CSS (tokens)                                            | não         |
| 5   | Movimento (curva, duração, "press")      | CSS (tokens)                                            | não (herda) |
| 6   | Sons                                     | JSON jsfxr com as mesmas chaves de `zerometro-sfx.json` | não (herda) |
| 7   | Microtexto                               | `ThemeCopy` em TS (≈ 15 chaves)                         | não         |
| 8   | Celebração                               | componente React registrado por evento                  | não         |

"Herda" significa que a camada usa o valor do tema base, o Cartucho atual. Um tema de nível **Paleta**
define só a camada 1. Um **Completo** define de 1 a 6. Um **Lendário** define todas.

## 2. O que existe hoje

| Item                                                                                     | Situação                                                                                                                          | Impacto                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tokens de cor (`--primary`, `--status-*`, `--heat-*`, `--chart-*`, `--flame*`)           | Bem feitos e usados de forma consistente                                                                                          | Cores já funcionam por tema                                                                                  |
| `<html class="dark">` fixo em `index.html`                                               | O app só roda em modo escuro; o modo claro em `:root` não é usado                                                                 | Precisa virar `data-theme` + `data-mode`                                                                     |
| `sonner.tsx` com `theme="dark"` e `<meta theme-color="#0f0e17">`                         | Fixos                                                                                                                             | Precisam seguir o tema                                                                                       |
| `--radius: 0px`, mas 12 componentes de `ui/` usam `rounded-none`                         | Ignoram o token                                                                                                                   | Trocar por `rounded-md` (que já aponta para `var(--radius)`)                                                 |
| `pixel-frame`, `-thin`, `-ink`, `pixel-drop`, `-bevel`, `-sunken`, `-press`, `-disabled` | Usados em 36, 18, 7, 15, 2, 2, 2 e 2 arquivos                                                                                     | Ótimo: só mudar a implementação, sem tocar nos componentes                                                   |
| Margens de reserva da moldura (`mt-1 ml-1 mr-3 mb-3` no Button, `m-1` no Card)           | Presas a 4px de moldura e 8px de sombra                                                                                           | Virar token (veja 3.3)                                                                                       |
| Escala de texto recalibrada para a VT323 (`text-sm` = 20px)                              | Global no `@theme`                                                                                                                | Uma fonte normal a 20px fica enorme: a escala tem que ser do tema                                            |
| `display-*` com tamanhos fixos para Press Start 2P                                       | 5 utilitários, mais de 140 usos                                                                                                   | Mudar só os utilitários                                                                                      |
| `text-[Npx]` soltos                                                                      | `recap-slides.tsx` (9), `__root.tsx` (2), `button.tsx` (2), `share-recap-dialog.tsx`, `game-hero.tsx`                             | Trocar por tokens                                                                                            |
| `shadow-[...]` fixos                                                                     | `game-cover`, `activity-heatmap`, `avatars`, `my-sessions`, `biblioteca`, `share-recap-dialog`, `recap-slides`, `__root`, `grupo` | Virar `frame-ring` e `tab-frame` (veja 3.3)                                                                  |
| `steps()` em animações                                                                   | 9 arquivos (`progress`, `dialog`, `alert-dialog`, `switch`, `game-row`, `game-card`, `game-hero`…)                                | Token de curva                                                                                               |
| Hex fixos                                                                                | `game-details.tsx` (cores da classificação indicativa) e `avatars.tsx` (paleta dos avatares)                                      | **Ficam como estão**: as cores da classificação são oficiais e o avatar é identidade, igual em qualquer tema |
| Gráficos (`recharts`)                                                                    | Já usam `var(--chart-*)`                                                                                                          | Funcionam                                                                                                    |
| Imagem do recap (satori, no servidor)                                                    | Cores da marca                                                                                                                    | Fica com a marca por enquanto; por tema numa fase futura                                                     |

## 3. Tokens novos

As convenções são as mesmas de hoje: variáveis cruas em `[data-theme]` e mapeamento no `@theme inline`.

### 3.1 Cores (existentes, mais estas)

```css
--surface-2:        /* segundo nível de card (hoje alguns lugares usam --secondary para isso) */ --overlay:          /* fundo do dialog; hoje é fixo no componente */
--selection:        /* ::selection */
--coin: --coin-foreground:   /* moeda da economia: chip de saldo e preço na loja */
--freeze:; /* dia protegido por congelamento no heatmap */
```

O contrato exige o conjunto completo. Um tema que deixe um token de fora quebra o teste do §6.

### 3.2 Tipografia

```css
--font-body:            /* hoje VT323 */ --font-display:         /* hoje Press Start 2P (substitui --font-pixel; manter um alias) */
--font-numeric:         /* números de estatística e timer (pode ser igual a --font-display) */

/* Escala de corpo: o @theme passa a ler daqui */
--fs-xs  --lh-xs        /* 18/20 no Cartucho; ~12/16 numa fonte comum */
--fs-sm  --lh-sm
--fs-base --lh-base
--fs-lg  --lh-lg
--fs-xl  --lh-xl
--fs-2xl --lh-2xl

/* Escala de display, usada pelos utilitários display-* */
--display-xl --display-xl-lh
--display-lg --display-lg-lh
--display-md --display-md-lh
--display-sm --display-sm-lh
--display-xs --display-xs-lh
--display-tracking:     /* 0.04em hoje */
--display-case:         /* uppercase | none, para display-xs e títulos */
--display-weight:       /* 400 na pixel; 800 num tema tipo Grove */
--display-style:; /* normal | italic (o Ladrão Fantasma quer itálico) */
```

No `@theme` atual, `--text-sm: 20px` vira `--text-sm: var(--fs-sm)`, e assim por diante. Tailwind v4 aceita
isso com `@theme inline`.

### 3.3 Forma

O ponto central: hoje **toda moldura é box-shadow**, e isso é bom, porque um box-shadow com `border-radius`
acompanha a curva. Basta o tema trocar a receita das sombras.

```css
--radius:               /* já existe; 0 no Cartucho, 12px no Moderno */ --radius-control:       /* botão e input (pode diferir do card) */

--frame-w:              /* espessura da moldura: 4px */
--frame-thin-w:         /* 2px */
--frame-shape:          /* stepped | ring: stepped = os 4 shadows com canto em degrau; ring = 0 0 0 Npx */
--drop:                 /* sombra elevada completa: "4px 8px 0 0 var(--pixel-shadow), 8px 4px 0 0 ..." */
--drop-soft:            /* para temas modernos: 0 8px 24px -8px color-mix(...) */
--bevel:                /* inset do bisel */
--sunken:               /* inset do afundado */
--press-translate:      /* 4px 4px no Cartucho; 0 1px no Moderno */

/* Espaço que a moldura e a sombra ocupam fora da caixa (substitui o mt-1 ml-1 mr-3 mb-3) */
--frame-gap:            /* = --frame-w */
--drop-gap:             /* = frame + deslocamento da sombra (12px hoje) */

/* Recorte da superfície (temas com painéis inclinados) */
--panel-clip:           /* none | polygon(...) */
--panel-skew:; /* 0deg | -4deg */
```

**Como os utilitários passam a funcionar.** Os nomes continuam os mesmos, então nenhum componente muda.

```css
@utility pixel-frame {
  --px-c: var(--px-frame-color, var(--border));
  box-shadow: var(--frame-recipe), var(--px-inset, 0 0 #0000), var(--px-drop, 0 0 #0000);
}
/* cada tema (ou o base) define --frame-recipe usando --px-c e --frame-w */
[data-frame-shape="stepped"] {
  --frame-recipe: 0 calc(-1*var(--frame-w)) 0 0 var(--px-c), ...;
}
[data-frame-shape="ring"] {
  --frame-recipe: 0 0 0 var(--frame-w) var(--px-c);
}
```

Um ponto em aberto: com `@property … inherits: false` nas variáveis `--px-*` (decisão correta, que deve
continuar), `--frame-recipe` precisa ser resolvido no próprio elemento. Por isso as receitas ficam em seletores
que casam com o elemento, como `:where([data-theme] *)`, ou repetidas por utilitário. Isso deve ser validado
no protótipo.

**Painéis recortados (estilo Ladrão Fantasma).** `clip-path` corta o box-shadow. Para recortar sem perder a
moldura, Card e Dialog passam a desenhar a superfície num `::before` (fundo, clip e skew), enquanto o conteúdo
fica reto por cima. É a única mudança estrutural, e ela fica restrita a `card.tsx`, `dialog.tsx` e
`alert-dialog.tsx`.

**Utilitários novos, para substituir os `shadow-[...]` fixos:**

| Novo                                                   | Substitui                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frame-ring` / `frame-ring-primary` / `frame-ring-ink` | `shadow-[0_0_0_2px_var(--pixel-shadow \| --primary \| --foreground \| --border)]` em game-cover, avatars, share-recap, recap-slides, __root, grupo |
| `frame-ring-inset`                                     | `shadow-[inset_0_0_0_2px_var(--foreground)]` no heatmap                                                                                            |
| `tab-frame`                                            | a aba "aberta embaixo" duplicada em `my-sessions.tsx:165` e `biblioteca.tsx:161`                                                                   |
| `frame-space` / `frame-space-drop`                     | `m-1` e `mt-1 ml-1 mr-3 mb-3`, que passam a usar `--frame-gap` e `--drop-gap`                                                                      |

### 3.4 Textura

```css
--bg-texture:           /* background-image do body: none | scanlines | pergaminho (SVG inline) | grade */ --bg-texture-size:
--overlay-texture:      /* o que bg-scanlines desenha hoje: vira token, e o utilitário só o aplica */
--menu-cursor-clip:     /* o ▶ pixelado do .menu-cursor; outro tema troca por ★, ◆, › */
--menu-cursor-size:
--cursor:; /* cursor do mouse: auto | url(data:...) */
```

### 3.5 Movimento

```css
--ease:                 /* steps(2) no Cartucho; cubic-bezier(.2,.8,.2,1) no Moderno */ --ease-enter:
--dur-fast:  --dur-base:  --dur-slow:
--blink:; /* animação do cursor; none em temas sóbrios */
```

Os 9 arquivos com `steps(...)` passam a usar `var(--ease)`. A regra de `prefers-reduced-motion` continua
valendo para todos.

### 3.6 Atributos no `<html>`

```html
<html data-theme="cartucho" data-mode="dark" data-frame-shape="stepped">
```

- `data-mode` substitui a classe `.dark`. `@custom-variant dark` passa a ser `(&:is([data-mode="dark"] *))`.
- Cada tema declara `modes: ["dark"] | ["light"] | ["dark","light"]`. Tijolinho Verde, por exemplo, só tem um.

## 4. Camadas em TS

### 4.1 Registro (`src/shared/themes.ts`)

Fica em `shared` porque o servidor valida a posse e o preço.

```ts
export const themeTiers = ["palette", "complete", "legendary"] as const;
export const themeCategories = ["retro", "modern", "iconic", "exclusive"] as const;

export interface ThemeDef {
  id: string; // "cartucho", "tijolinho-verde", "ladrao-fantasma"
  name: string;
  category: (typeof themeCategories)[number];
  tier: (typeof themeTiers)[number];
  price: number | null; // null = não se compra (Fundador, insígnias)
  unlockedBy?: string; // id da insígnia
  modes: readonly ("dark" | "light")[];
  frameShape: "stepped" | "ring";
  swatch: [string, string, string]; // prévia na loja, sem carregar o CSS
  themeColor: Record<"dark" | "light", string>; // <meta theme-color>
  fonts?: readonly string[]; // pacotes @fontsource para importar sob demanda
  soundPack?: string;
  copy?: string;
  celebrations?: string;
}
```

### 4.2 Microtexto (`ThemeCopy`)

Não é i18n do app inteiro. São só os **momentos** em que o tema aparece.

```ts
export interface ThemeCopy {
  gameFinished: string; // "Zerado!" → "Missão cumprida" / "Golpe concluído"
  sessionStart: string; // "Bora jogar"
  sessionStop: string; // "Sessão salva" → "Jogo salvo na máquina de escrever"
  streakAlive: string;
  streakAtRisk: string;
  streakMilestone: (days: number) => string;
  goalReached: string;
  coinsEarned: (n: number) => string;
  emptyLibrary: string;
  rouletteWin: string;
  loading: string; // "Carregando..." → "Now loading"
}
```

Uso: `const copy = useThemeCopy()`. Os textos-padrão saem dos componentes atuais.

### 4.3 Sons

O `sounds.ts` hoje faz `import definitions from "./zerometro-sfx.json"` e o `SoundName` sai das chaves do JSON.
A mudança:

- O JSON atual vira o pacote `cartucho`.
- O tipo é `SoundPack = Record<SoundName, SfxrParams>`, e o `SoundName` passa a vir de uma lista explícita,
  não do JSON.
- Os pacotes são carregados com `import()` dinâmico. Ao trocar de pacote, o cache `buffers` é esvaziado.
- Um teste garante que todo pacote tem todas as chaves de `soundNames`.
- `sound-events.ts` (prioridades e marcos) não muda.

### 4.4 Celebrações

```ts
type CelebrationEvent = "game-finished" | "streak-milestone" | "goal-reached" | "coins-earned";
type Celebration = React.LazyExoticComponent<React.FC<{ onDone(): void }>>;
```

Um `<CelebrationHost/>` no `__root.tsx` escuta os mesmos eventos que já disparam os sons e renderiza a
celebração do tema, ou nada. Ela é sempre curta (até 2s), pode ser pulada, e com `reduced-motion` vira só
um toast.

## 5. Aplicação e persistência

1. **Sem piscar na abertura.** Um script inline no `index.html`, antes do bundle, lê `localStorage["zm:theme"]`
   e seta `data-theme`, `data-mode` e `data-frame-shape`. O CSS do tema base vai no bundle; os outros entram
   por `<link>` sob demanda (`/themes/<id>.css`). Enquanto o CSS carrega, o base cobre.
2. **Fonte da verdade.** `settings.themeId` (e `soundPackId`) no `kv`, validados no servidor contra
   `user_items`. O `localStorage` é só cache para a primeira pintura.
3. **`ThemeProvider`** (zustand, como os stores atuais) aplica os atributos, troca o `<meta theme-color>`, passa
   o `theme` do sonner, carrega fontes e o pacote de som.
4. **Pré-visualização na loja.** Aplica o tema só em memória, sem salvar, com uma faixa fixa
   "Pré-visualizando Ladrão Fantasma · Comprar 800 🪙 · Voltar". Sair da loja reverte.
5. **Posse.** Tabela `user_items (userId, itemId, kind, acquiredAt, source)`, com `source` em
   `purchase | badge | gift | founder`. A compra lança um débito no `coin_ledger` dentro da mesma transação.

## 6. Garantias (testes)

- **Completude:** para cada tema e cada modo, um teste (bun) faz o parse do CSS e verifica se todos os tokens
  obrigatórios estão definidos.
- **Contraste:** pares `X` e `X-foreground` (primary, status, score, card…) têm contraste de pelo menos 4.5:1,
  calculado no mesmo teste. Tema que não passa não entra.
- **Pacote de som completo** (§4.3).
- **Regressão visual:** o Playwright tira screenshots de 3 telas (início, biblioteca, jogo) em cada tema. Roda
  sob demanda, não no CI comum.
- **Lint simples:** um script que falha ao achar `rounded-none`, `shadow-[` ou `text-[\d+px]` em `src/web`,
  com uma lista de exceções (classificação indicativa, avatares).

## 7. Ordem de execução

**Fase 1: refatorar sem mudar nada visualmente.** O app deve sair idêntico, pixel a pixel.

1. Criar os tokens de tipografia, forma, textura e movimento com os valores atuais.
2. Fazer `@theme` e os utilitários (`pixel-*`, `display-*`, `bg-scanlines`, `.menu-cursor`) lerem os tokens.
3. Trocar `rounded-none` por `rounded-md` nos 12 componentes de `ui/`.
4. Criar `frame-ring*`, `tab-frame`, `frame-space*` e substituir os `shadow-[...]` e as margens de reserva.
5. Trocar os `text-[Npx]` por tokens e os `steps()` por `var(--ease)`.
6. Trocar `.dark` por `data-mode`, e fazer sonner e `theme-color` seguirem o tema.
7. Screenshots antes e depois para provar que nada mudou.

> **Fase 1: feita.** O que mudou em relação ao plano acima (o código manda; os comentários de
> `styles.css` são a referência):
>
> - **Tokens com nomes finais**, no bloco "Tema base" de `styles.css`: `--body-font`, `--display-font`,
>   `--display-{xl..xs}` (e `-lh`), `--display-xs-case`, `--display-xs-tracking`, `--btn-{sm,lg}-{size,lh}`,
>   `--control-radius`, `--frame-offset`/`--frame-spread` (e `-thin-`), `--drop`, `--bevel-size`,
>   `--sunken-size`, `--press-translate`, `--frame-gap`, `--drop-gap`, `--overlay-texture`,
>   `--menu-cursor-{width,height,shape}`, `--ease-{ui,reveal,progress}`.
> - **Escala de texto:** sem `--fs-*`. O `@theme` do Tailwind já publica `--text-*` e `--animate-*` como
>   variáveis, então um tema sobrescreve `--text-sm` direto.
> - **Moldura sem `data-frame-shape`:** em degrau é `--frame-offset: 4px; --frame-spread: 0`, e em anel é
>   `--frame-offset: 0; --frame-spread: 1px`. A mesma fórmula cobre os dois casos.
> - **`--display-weight` e `--display-style` ficam sem valor no tema base**, e com isso `display-*` herda
>   peso e estilo, como antes. Um tema que defina os dois muda todos os títulos.
> - **`data-mode`** substituiu `.dark`, e `data-theme="cartucho"` já está no `<html>`. O sonner lê o modo
>   em `lib/theme.ts`. O `<meta theme-color>` fica para a fase 3, junto do `ThemeProvider`.
> - **Utilitários novos:**
>   - `frame-ring` / `frame-ring-<cor>` / `frame-inset`: anéis de 2px.
>   - `tab-frame`.
>   - `frame-space` / `frame-space-drop`: margens que reservam o espaço da moldura. O `cn()`
>     (tailwind-merge) sabe que elas conflitam com `m-*`.
> - **Exceções mantidas:** `recap-slides.tsx` continua em px fixos, porque espelha a imagem do recap
>   (veja §8). A classificação indicativa e os avatares também ficam como estão.
> - **Bug corrigido:** em `/grupo`, o card do próprio usuário tinha um anel `--primary` que nunca aparecia,
>   porque o `pixel-frame` do Card sobrescrevia o `box-shadow`. Agora a moldura dele é laranja
>   (`[--px-frame-color:var(--primary)]`). É a única mudança visual da fase.
> - **Verificação:** capturas de 26 telas e estados, comparando os pixels e os estilos computados de cada
>   elemento antes e depois. Saiu idêntico, tirando ruído de tempo (timer e carregamento de capas). Um
>   tema de teste injetado (fonte serifada, anel de 1px, botão em pílula, sombra suave, display em
>   itálico) mudou a interface inteira só por tokens.
> - **Para a fase 2** (ainda fixo, visto no tema de teste): `border-b-4` no header e outras larguras de
>   borda do Tailwind; o bisel e o afundado já são tokens, mas precisam de valores próprios por tema.

**Fase 2: provar o contrato com dois temas opostos.**

- **Minimal (moderno):** raio de 12px, moldura `ring` de 1px, sombra suave, fonte sem pixel, escala de texto
  normal, `--ease` com curva suave. Se ele ficar bonito sem gambiarra, o contrato está certo.
- **Ladrão Fantasma (icônico):** painel recortado via `::before`, display em itálico e pesado, alto contraste.
  Ele valida o caso extremo.

Os dois ficam escondidos atrás de uma flag de desenvolvimento até a loja existir.

> **Fase 2: feita.** Os dois temas estão em `src/web/themes/`, e o registro em `src/shared/themes.ts`.
>
> - **Como um tema é escrito:**
>   - um CSS com `:root[data-theme="<id>"]` para os tokens de forma, tipografia e movimento;
>   - `:root[data-theme="<id>"][data-mode="<modo>"]` para as cores;
>   - importado no `styles.css`.
>
>   O seletor com `:root` vence o tema base pela especificidade, então a ordem dos arquivos não importa.
>   As escalas do Tailwind (`--text-*`, `--animate-*`) são sobrescritas direto.
>
> - **Ganchos para redesenhar componentes:** `data-slot` (`card`, `dialog-content`, `alert-dialog-content`,
>   `button`, `xp-bar`…) e `data-variant` no botão. Um tema pode estilizar esses atributos além dos tokens.
>   O Ladrão Fantasma usa isso para os painéis e para os botões inclinados.
> - **Painéis recortados sem mudar a estrutura:** saiu melhor que o `::before` planejado. O tema troca
>   fundo e moldura do card por um `border-image` 9-slice: um SVG com polígono preto, contorno branco e
>   camada vermelha deslocada. Os cantos de 40px ficam fixos e as bordas esticam, então funciona em
>   qualquer tamanho. Esticar o SVG inteiro (a primeira tentativa) deixava a sombra vermelha
>   desproporcional nos cards largos.
> - **Tokens novos desta fase:**
>   - `--rule` e `--rule-thick`: bordas e divisores;
>   - `--inner-line`: a linha de dentro dos dialogs;
>   - `--focus-width` e `--focus-offset`;
>   - `--page-texture` e `--page-texture-size`;
>   - `--card-ridge`: as ranhuras do cartucho;
>   - `--xp-gap`: o espaço entre as células da barra de XP.
>
>   O `tab-frame` passou a usar `--rule-thick` e funciona com moldura em anel.
>
> - **Prévia:** em `/ajustes`, fora de produção, um card troca o tema neste aparelho. O cuidado é este:
>   - `lib/theme.ts` aplica o tema e guarda no `localStorage` já resolvido (id, modo, fontes, cor da barra);
>   - um script inline no `index.html` aplica esse valor antes da primeira pintura, sem piscar o tema base;
>   - as fontes do tema (Google Fonts) só carregam quando ele está ativo.
> - **Testes** (`src/web/themes/themes.test.ts`): todo tema do registro tem CSS importado, define todas as
>   cores em cada modo e passa no contraste de 4.5:1 nos pares texto/fundo. Conferi que o teste falha
>   quando falta um token ou o contraste cai.
> - **O tema base continua igual pixel a pixel:** a comparação de capturas antes e depois só acusou o card
>   de prévia novo em `/ajustes`.
> - **O que ficou para a fase 3:**
>   - o tema salvo na conta (hoje só no aparelho);
>   - a posse (`user_items`);
>   - os pacotes de som por tema;
>   - incluir `recap-slides` e a imagem do recap nos temas;
>   - uma revisão visual tela a tela (estatísticas, perfil, recap) em cada tema.

**Fase 3: infraestrutura.** `themes.ts`, `ThemeProvider`, script contra piscada, `user_items`, pacotes de som e
os testes de completude e contraste.

**Fase 4: loja v1** (depende da economia), com pré-visualização e cerca de 6 temas.

**Fase 5: camadas ricas** (`ThemeCopy` e celebrações) nos temas Lendários.

## 8. Fora de escopo por enquanto

- Tema na imagem do recap (satori). Exige portar os tokens para objetos JS no servidor.
- O amigo ver o seu tema no `/amigo`. Uma opção futura é uma "moldura de perfil" mais barata, em vez de
  aplicar o tema inteiro na tela de outra pessoa.
- Editor de tema do próprio usuário.
