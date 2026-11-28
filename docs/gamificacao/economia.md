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

## Próximos passos

1. **Loja v1** (fase 4 dos temas): preço por tema e pacote, compra (débito mais posse numa
   transação) e a prévia que já existe.
2. **Insígnias e bônus simbólico do passado:** Platinador Veterano, Arqueólogo e Fundador.
3. **Proteção de ofensiva:** congelamento comprado com moedas, com estoque máximo de 2.
4. **A decidir:**
   - bônus por zerar (proporcional às horas do jogo, para não valer a pena fraudar);
   - peso menor para sessões manuais ou via MCP, se o teto diário não bastar;
   - incluir o RetroAchievements, que também é verificável pela API.
