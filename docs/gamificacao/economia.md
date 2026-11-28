# Economia de moedas

Moedas para trocar por personalização: temas e sons agora, e o avatar mais adiante. As regras
estão em `src/shared/economy.ts`, o livro-razão em `src/server/services/economy.ts` e a interface
em `/carteira`.

## Decisões

- **Rende a partir do cadastro de cada perfil.** Os registros começaram junto com a economia, então
  ninguém sai muito na frente.
- **Horas jogadas:** todas as fontes de sessão contam (timer, registro manual, MCP, Steam). Só o
  "antes do Zerômetro" (`prior_minutes`) fica de fora, e ele nem é sessão.
- **Conquistas:** só as da Steam que vieram da sincronização, porque dá para comprovar. As marcadas à
  mão e as do RetroAchievements não rendem.
- **O passado não vira moeda.** No máximo vira insígnias e um bônus simbólico, com escopo próprio,
  ainda por fazer.

## Regras (v1)

| Origem             | Valor                                                                            | Limites                                                                                   |
| ------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Horas jogadas      | 10 moedas por hora, somando o dia                                                | Teto de 6h por dia (60 moedas). Só dias desde o cadastro. O timer rodando ainda não conta |
| Conquista da Steam | 50 (até 5%), 30 (até 10%), 15 (até 25%), 10 (até 50%), 5 (comum ou sem raridade) | Desbloqueada depois do cadastro e vinda da sincronização                                  |

Para mudar um número, edite `shared/economy.ts`. A próxima leitura da carteira lança a diferença
como ajuste para todo mundo.

## Arquitetura

- **Livro-razão só de inserção** (`coin_ledger`, migration `0018_moedas`): `amount` (nunca 0),
  `reason`, `ref_key` e `details` (JSON para a interface descrever). O saldo é a soma.
- **Ganhos derivados por reconciliação:**
  - `reconcileWallet` calcula quanto cada origem deveria valer: `day:YYYY-MM-DD` para as horas,
    `achievement:<id>` para as conquistas;
  - compara com o que já está lançado para aquela origem e insere só a diferença.

  Editar uma sessão vira um ajuste negativo ou positivo, e apagar todas as sessões de um dia estorna
  o dia. Nada é apagado. É idempotente: rodar sem mudança não lança nada.

- **Quando roda:** a cada leitura da carteira (`GET /api/wallet`, tool `get_wallet` do MCP). O SQLite
  é síncrono num processo só, então duas leituras não lançam em dobro.
- **Na interface:** a chave da carteira fica debaixo de `statsKeys`. Tudo que já invalidava as
  estatísticas (sessões, sincronização de conquistas) atualiza o saldo também.
- **Saídas (fase 4, loja):** `reason: "purchase"` com valor negativo e `ref_key` do item
  (`theme:minimal`), na mesma transação do `grantItem(..., "purchase")`. O motivo `grant` fica para
  o admin dar moedas.

## Interface

- **Saldo no menu** (a partir de `sm`), levando a `/carteira`. No celular o menu já está no limite,
  então o atalho fica no topo de `/ajustes`, onde o avatar do menu leva.
- **`/carteira`:** saldo, quanto veio de horas e de conquistas, "rendendo desde", como ganhar (gerado
  das mesmas regras) e o histórico, com os ajustes descritos.

## Loja (v1)

- **Preços** em `shared/items.ts` (`themePrices`, `soundPackPrices`). `null` quer dizer que o item
  não está à venda (grátis ou exclusivo).

  | Item                 | Preço |
  | -------------------- | ----- |
  | Minimal              | 250   |
  | Ladrão Fantasma      | 400   |
  | Pacote de som avulso | 80    |

  Referência: no ritmo do demo rende ~18 moedas por dia, então 250 é cerca de duas semanas.

- **Compra** (`services/shop.ts`, `POST /api/shop/purchase`):
  - acerta a carteira, confere o preço, a posse e o saldo;
  - numa transação só, lança o débito (`reason: "purchase"`, `ref_key` `theme:minimal`) e concede
    o item com `grantItemIn(..., "purchase")`. Um tema traz o pacote de som dele;
  - erros: `insufficient_coins` (409, a mensagem diz quanto falta) e `conflict` (já tem ou não
    está à venda).
- **Vitrine:** `GET /api/shop` devolve os itens à venda, mais o que o perfil já tem, e o saldo.
- **Interface:**
  - `/loja` tem cards de tema com amostra de cores (`swatch` no registro), **Experimentar**
    (a prévia), **Comprar** (com confirmação; sem saldo, mostra "Faltam N") e **Usar/Em uso**.
    Os pacotes de som têm **Ouvir**, que toca um som do pacote sem trocar o ativo;
  - durante a prévia, uma **faixa fixa** acompanha a navegação pelo app inteiro com
    "Comprar" e "Voltar ao meu tema";
  - um tema comprado entra em uso na hora. Isso fica no `usePurchase`, não no botão: o botão some
    quando o item vira "seu", e callbacks de componente desmontado não rodam;
  - a `/carteira` liga para a loja, e o card Aparência sempre aparece, com link para a loja.

## Próximos passos

1. **Insígnias e bônus simbólico do passado:** Platinador Veterano, Arqueólogo e Fundador.
2. **Proteção de ofensiva:** congelamento comprado com moedas, com estoque máximo de 2.
3. **A decidir:**
   - bônus por zerar (proporcional às horas do jogo, para não valer a pena fraudar);
   - peso menor para sessões manuais ou via MCP, se o teto diário não bastar;
   - incluir o RetroAchievements, que também é verificável pela API.
