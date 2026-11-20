import type { ReactNode } from "react";
import {
  type AgeRating,
  type GameLink,
  type IgdbGamePage,
  type LanguageSupport,
  type PlatformRelease,
  ptBrSupport,
  storeLinkKinds,
} from "@shared/game-page";
import {
  ageRatingOrgLabels,
  gameLinkLabels,
  gameModeLabel,
  languageLabel,
  perspectiveLabel,
  themeLabel,
} from "@shared/game-labels";
import { igdbGameUrl } from "@shared/igdb";
import { ExternalLink } from "@/components/external-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatReleaseDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// Coluna de detalhes da aba "Sobre": onde comprar, lançamento, português, classificação,
// temas e links. Cada bloco some sem dado.

export function GameDetails({ game }: { game: IgdbGamePage }) {
  const stores = game.links.filter((l) => storeLinkKinds.has(l.kind));
  const otherLinks = game.links.filter((l) => !storeLinkKinds.has(l.kind));
  const facts: [string, string[]][] = [
    ["Temas", game.themes.map(themeLabel)],
    ["Modos", game.gameModes.map(gameModeLabel)],
    ["Perspectiva", game.perspectives.map(perspectiveLabel)],
    ["Engine", game.engines],
  ];

  return (
    <div className="space-y-8">
      {stores.length > 0 && (
        <Block title="Onde comprar">
          <ul className="flex flex-wrap gap-2">
            {stores.map((link) => (
              <li key={link.kind}>
                <StoreLink
                  link={link}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                />
              </li>
            ))}
          </ul>
        </Block>
      )}

      {game.releases.length > 0 && (
        <Block title="Lançamento">
          <Releases releases={game.releases} />
        </Block>
      )}

      {game.languages.length > 0 && (
        <Block title="Idiomas">
          <Languages languages={game.languages} />
        </Block>
      )}

      {game.ageRating && (
        <Block title="Classificação">
          <AgeRatingBadge rating={game.ageRating} />
        </Block>
      )}

      {facts.some(([, values]) => values.length > 0) && (
        <dl className="space-y-4">
          {facts.map(
            ([label, values]) =>
              values.length > 0 && (
                <div key={label}>
                  <dt className="display-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-2 text-sm">{values.join(" · ")}</dd>
                </div>
              ),
          )}
        </dl>
      )}

      <Block title="Links">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {otherLinks.map((link) => (
            <li key={link.kind}>
              <StoreLink
                link={link}
                className="text-info underline decoration-2 underline-offset-4"
              />
            </li>
          ))}
          <li>
            <StoreLink
              link={{ kind: "official", url: igdbGameUrl(game) }}
              label="IGDB"
              className="text-info underline decoration-2 underline-offset-4"
            />
          </li>
        </ul>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="display-xs text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function StoreLink({
  link,
  label = gameLinkLabels[link.kind],
  className,
}: {
  link: GameLink;
  label?: string;
  className?: string;
}) {
  return (
    <ExternalLink href={link.url} className={cn("gap-2", className)}>
      {label}
    </ExternalLink>
  );
}

/** Uma linha por data; com uma data só, as plataformas já estão no cabeçalho. */
function Releases({ releases }: { releases: PlatformRelease[] }) {
  if (releases.length === 1) {
    const [only] = releases;
    return only ? (
      <p className="text-sm">
        {formatReleaseDate(only.date, only.precision)}
        <span className="text-muted-foreground"> · todas as plataformas</span>
      </p>
    ) : null;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {releases.map((r) => (
        <li key={`${r.date}-${r.platforms.join()}`}>
          <span className="tabular-nums">{formatReleaseDate(r.date, r.precision)}</span>
          <span className="text-muted-foreground"> · {r.platforms.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Legendas e interface", "Áudio, legendas e interface"… */
function supportText(l: LanguageSupport): string {
  const parts = [l.audio && "áudio", l.subtitles && "legendas", l.interface && "interface"].filter(
    (p): p is string => Boolean(p),
  );
  if (parts.length === 0) return "";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** O que importa é ter português do Brasil; a lista completa fica recolhida. */
function Languages({ languages }: { languages: LanguageSupport[] }) {
  const ptBr = ptBrSupport(languages);
  return (
    <div className="space-y-2">
      {ptBr ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge className="bg-score-good text-score-good-foreground">PT-BR</Badge>
          {supportText(ptBr)}
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">Sem PT-BR</Badge>
          segundo o IGDB
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Todos os idiomas ({languages.length})
        </summary>
        <ul className="mt-2 space-y-1">
          {languages
            .map((l) => ({ ...l, label: languageLabel(l.name) }))
            .toSorted((a, b) => a.label.localeCompare(b.label, "pt-BR"))
            .map((l) => (
              <li key={l.name}>
                {l.label}
                <span className="text-muted-foreground"> · {supportText(l).toLowerCase()}</span>
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}

/** Cores oficiais da classificação indicativa brasileira. */
const CLASSIND_COLORS: Record<string, string> = {
  L: "bg-[#009a44] text-white",
  "10": "bg-[#0094d9] text-white",
  "12": "bg-[#f8c300] text-black",
  "14": "bg-[#f07f1a] text-black",
  "16": "bg-[#e2001a] text-white",
  "18": "bg-black text-white",
};

function AgeRatingBadge({ rating }: { rating: AgeRating }) {
  if (rating.org === "classind") {
    const title =
      rating.rating === "L"
        ? "Livre para todos os públicos"
        : `Não recomendado para menores de ${rating.rating} anos`;
    return (
      <p className="flex items-center gap-3 text-sm">
        <span
          className={cn(
            "grid size-10 place-items-center display-sm pixel-frame-thin",
            CLASSIND_COLORS[rating.rating] ?? "bg-muted",
          )}
          aria-hidden
        >
          {rating.rating}
        </span>
        {title}
      </p>
    );
  }
  return (
    <Badge variant="outline">
      {ageRatingOrgLabels[rating.org]} {rating.rating}
    </Badge>
  );
}
