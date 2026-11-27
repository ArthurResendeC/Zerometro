import { createFileRoute, Link } from "@tanstack/react-router";
import {
  criterionGroupLabels,
  criterionGroups,
  presetDefs,
  ratingCriteria,
  ratingPresets,
} from "@shared/rating-criteria";
import { BLEND_WEIGHT, MIN_APPLICABLE_CRITERIA } from "@shared/ratings";
import { Card } from "@/components/ui/card";

// "Como avaliamos": a base teórica da avaliação guiada e o que cada critério pergunta.

export const Route = createFileRoute("/como-avaliamos")({ component: HowWeRatePage });

const blendPercent = Math.round(BLEND_WEIGHT.default * 100);

function HowWeRatePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="display-lg">Como avaliamos</h1>
        <p className="text-muted-foreground">
          A nota do Zerômetro mede a <strong className="text-foreground">sua experiência</strong>{" "}
          com o jogo, não a "qualidade objetiva" dele. Cada critério é uma pergunta de 1 a 7 sobre
          como o jogo funciona e como você se sentiu; no fim, a nota de coração diz quanto você
          gostou no geral.
        </p>
      </header>

      <Card className="space-y-3">
        <h2 className="display-sm">A base</h2>
        <ul className="space-y-3 text-sm">
          <li>
            <strong>PXI / miniPXI</strong> (Vanden Abeele et al.): mede a experiência do jogador em
            dois níveis, o <em>funcional</em> (como o jogo funciona) e o <em>psicossocial</em> (como
            você se sentiu). O miniPXI faz uma pergunta por construto, o que vira um passo por
            critério aqui. É a base principal.
          </li>
          <li>
            <strong>GameFlow</strong> (Sweetser & Wyeth, 2005): oito elementos da diversão
            (concentração, desafio, habilidades, controle, objetivos claros, feedback, imersão e
            interação social). Daqui vem o critério opcional Social/coop.
          </li>
          <li>
            <strong>PENS</strong> (Rigby & Ryan): competência, autonomia, relação com os outros,
            presença e controles intuitivos. Só inspiração.
          </li>
          <li>
            <strong>Extras do Zerômetro</strong>: Narrativa e Parte técnica, que o PXI não cobre.
          </li>
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="display-sm">A conta</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>Cada nota de 1 a 7 vira 0 a 10: (nota − 1) ÷ 6 × 10.</li>
          <li>
            A nota calculada é a média ponderada pelos pesos. "Não se aplica" tira o critério da
            conta e os pesos dos outros se redistribuem.
          </li>
          <li>
            Com menos de {MIN_APPLICABLE_CRITERIA} critérios avaliados não há nota calculada: vale a
            de coração.
          </li>
          <li>
            A nota final, por padrão, mistura as duas: {blendPercent}% calculada e{" "}
            {100 - blendPercent}% coração. Dá para usar só uma delas em{" "}
            <Link to="/ajustes" className="text-info underline">
              Ajustes
            </Link>
            .
          </li>
          <li>
            Se a calculada e a de coração ficarem 2 pontos ou mais distantes, o resumo sugere
            revisar: às vezes um critério ficou fora do lugar, às vezes o coração tem razão.
          </li>
          <li>
            Os pesos usados ficam guardados com a avaliação: mudar os pesos depois não altera notas
            antigas.
          </li>
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="display-sm">Tipos de jogo</h2>
        <p className="text-sm text-muted-foreground">
          O tipo é sugerido pelos gêneros do IGDB e ajusta os pesos (dá para trocar ao avaliar).
        </p>
        <dl className="space-y-2 text-sm">
          {ratingPresets
            .filter((p) => p !== "custom")
            .map((p) => (
              <div key={p}>
                <dt className="text-foreground">{presetDefs[p].label}</dt>
                <dd className="text-muted-foreground">{presetDefs[p].description}</dd>
              </div>
            ))}
        </dl>
      </Card>

      {criterionGroups.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="display-md">{criterionGroupLabels[group]}</h2>
          {ratingCriteria
            .filter((c) => c.group === group)
            .map((c) => (
              <Card key={c.id} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="display-xs">
                    {c.label}
                    {c.optional && <span className="text-muted-foreground"> (opcional)</span>}
                  </h3>
                  <span className="shrink-0 text-xs text-muted-foreground">peso {c.weight}</span>
                </div>
                <p>{c.question}</p>
                <p className="text-sm text-muted-foreground">
                  1 = {c.low} · 7 = {c.high}
                </p>
                <p className="text-sm">{c.why}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground">Exemplo:</span> {c.example}
                </p>
              </Card>
            ))}
        </section>
      ))}
    </div>
  );
}
