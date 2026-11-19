# 🎮 Zerômetro

> Quanto falta pra zerar?

Tracker pessoal de jogos: backlog, tempo jogado por dia, ofensiva e estimativa de quanto falta para zerar cada jogo. Tudo também pode ser controlado por IA através de um servidor **MCP**.

> 🚧 **Em desenvolvimento.** Este README descreve o que o projeto está construindo; alguns itens ainda não existem.

---

## ✨ Funcionalidades

- **Biblioteca por status:** jogando, zerados, próximos, lista de desejos, pausados e abandonados
- **Dados do IGDB:** busca de jogos com capa, plataformas, gêneros e ano de lançamento
- **Registro de sessões:** quanto tempo joguei, em qual dia e qual jogo
- **Estatísticas:**
  - 🔥 ofensiva atual e recorde (dias seguidos jogando)
  - média diária e semanal
  - heatmap anual estilo GitHub
  - horas por jogo e por semana
- **Tempo para zerar:** história, história + extras e 100%, com o progresso estimado de cada jogo
- **Servidor MCP:** adicionar jogos, mudar status e registrar tempo jogado conversando com uma IA (ex.: *"joguei 2h de Persona hoje"*)

### Planejado
- [ ] Registro automático pela presença do Discord (via [Lanyard](https://github.com/Phineas/lanyard))
- [ ] Sincronização de tempo jogado da Steam
- [ ] Retrospectiva do ano
- [ ] PWA

---

## 🧱 Stack

| Camada | Tecnologia |
| --- | --- |
| Runtime | [Bun](https://bun.sh) |
| API | [Hono](https://hono.dev) |
| Banco | SQLite (`bun:sqlite`) + [Drizzle ORM](https://orm.drizzle.team) |
| Frontend | React + TypeScript |
| Rotas / dados / forms / tabelas | [TanStack](https://tanstack.com) Router, Query, Form e Table |
| UI | [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS |
| Estado de UI | Zustand |
| Validação | Zod (compartilhado entre API, frontend e MCP) |
| IA | [Model Context Protocol](https://modelcontextprotocol.io) (Streamable HTTP) |
| Dados de jogos | [IGDB API](https://api-docs.igdb.com) |

Um único processo Bun serve a API, o servidor MCP e o frontend.

```
src/
  server/
    routes/    # REST (/api/*) consumido pelo frontend
    mcp/       # tools do servidor MCP (/mcp)
    services/  # regras de negócio, usadas por REST e MCP
    db/        # schema e migrations
    jobs/      # tarefas agendadas
  web/         # SPA React
  shared/      # schemas Zod e tipos compartilhados
```

---

## 🚀 Rodando localmente

### Pré-requisitos
- [mise](https://mise.jdx.dev): instala as versões certas do Bun e do Node e centraliza variáveis de ambiente e tarefas no `mise.toml`
- Credenciais do IGDB: crie um app no [Twitch Developer Console](https://dev.twitch.tv/console/apps) para obter `client_id` e `client_secret`

### Passos

```bash
git clone https://github.com/<seu-usuario>/zerometro.git
cd zerometro
mise trust && mise install   # Bun e Node nas versões do mise.toml
mise run install             # dependências
cp .env.example .env         # preencha as variáveis
mise run db:migrate
mise run dev                 # http://localhost:3000
```

Outras tarefas (`mise tasks` lista todas):

| Tarefa | O que faz |
| --- | --- |
| `mise run check` | typecheck + testes |
| `mise run build` / `mise run start` | build de produção em `dist/` e execução |
| `mise run db:generate` | gera migration a partir do schema |
| `mise run db:studio` | abre o Drizzle Studio |
| `mise run mcp:inspect` | abre o MCP Inspector |

### Variáveis de ambiente

Os padrões ficam no `[env]` do `mise.toml`; valores locais e segredos vão no `.env` (carregado pelo mise, não versionado).

| Variável | Descrição |
| --- | --- |
| `IGDB_CLIENT_ID` | Client ID do app na Twitch |
| `IGDB_CLIENT_SECRET` | Client Secret do app na Twitch |
| `APP_PASSWORD` | Senha de acesso ao painel |
| `MCP_TOKEN` | Token bearer para o servidor MCP |
| `DATABASE_PATH` | Caminho do arquivo SQLite (padrão: `data/zerometro.db` na raiz do projeto) |
| `PORT` | Porta do servidor (padrão: `3000`) |
| `TZ` | Fuso usado nas estatísticas (padrão: `America/Sao_Paulo`) |

---

## 🤖 Usando com IA (MCP)

O Zerômetro expõe um servidor MCP em `/mcp`. Com ele, um cliente como o Claude pode ler e alterar a sua biblioteca.

**Tools disponíveis:** `search_igdb`, `list_library`, `get_game`, `get_stats`, `list_sessions`, `add_game`, `set_status`, `log_session`, `update_session`, `update_game_entry`, `remove_game`, `delete_session`

Ações destrutivas só são executadas com confirmação explícita.

Exemplo de configuração no Claude Code:

```bash
claude mcp add --transport http zerometro https://seu-dominio/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

Para inspecionar as tools localmente:

```bash
npx @modelcontextprotocol/inspector
```

---

## 🙏 Créditos

- Dados de jogos e tempos para zerar fornecidos pelo [IGDB](https://www.igdb.com)
- Projeto pessoal, sem afiliação com IGDB, Twitch ou qualquer publisher

---

## 📄 Licença

[MIT](./LICENSE)
