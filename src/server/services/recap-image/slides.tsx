import type { CSSProperties, ReactNode } from "react";
import { completionTypeLabels } from "../../../shared/domain";
import { formatMinutes } from "../../../shared/format";
import { genreLabel } from "../../../shared/genres";
import type { Recap } from "../../../shared/recap";
import type { RecapSlideId } from "../../../shared/recap-slides";
import {
  comparison,
  dayLabel,
  periodLabel,
  plural,
  profileFacts,
  profileTitle,
  recapKicker,
} from "../../../shared/recap-text";
import { PIXEL_FONT, TEXT_FONT } from "./assets";
import { C, Cover, type Covers, ellipsis, flex, Root } from "./parts";

// A imagem de cada slide do recap (stories 1080×1920), espelhando os slides da web
// (src/web/features/recap/recap-slides.tsx) com as cores do tema escuro. Os tamanhos são os da
// web (moldura de 450px de largura) vezes K, então dá para comparar um com o outro.

const K = 1080 / 450;
const u = (n: number) => Math.round(n * K);

interface Theme {
  bg: string;
  fg: string;
}

/** Mesmas cores de `slideThemes` na web, no tema escuro. */
const themes: Record<RecapSlideId, Theme> = {
  intro: { bg: "#ff7a1a", fg: "#1a0d00" },
  games: { bg: "#3ec7e0", fg: "#001a20" },
  genres: { bg: "#c49bff", fg: "#1a0d26" },
  discoveries: { bg: "#6bd66b", fg: "#0b1a0b" },
  moments: { bg: C.card, fg: C.fg },
  profile: { bg: C.fg, fg: C.bg },
  trophies: { bg: "#ffd23f", fg: "#1a1400" },
  summary: { bg: C.card, fg: C.fg },
  empty: { bg: C.card, fg: C.fg },
};

/** "#rrggbb" + opacidade → rgba (o `bg-current/20` da web). */
function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Tipografia da web (styles.css), em px da web.
const font = (family: string, size: number, line: number): CSSProperties => ({
  fontFamily: family,
  fontSize: u(size),
  lineHeight: `${u(line)}px`,
});
const displayXs: CSSProperties = {
  ...font(PIXEL_FONT, 10, 12),
  textTransform: "uppercase",
  letterSpacing: u(0.4),
};
const displaySm = font(PIXEL_FONT, 12, 16);
const displayMd = font(PIXEL_FONT, 16, 24);
const displayLg = font(PIXEL_FONT, 24, 32);
const textSm = font(TEXT_FONT, 20, 24);
const textLg = font(TEXT_FONT, 26, 28);
const textXl = font(TEXT_FONT, 28, 32);
const text2xl = font(TEXT_FONT, 32, 36);
const dim: CSSProperties = { opacity: 0.8 };
const clamp = (lines: number): CSSProperties => ({ display: "block", lineClamp: lines });
const col = (style: CSSProperties = {}) => flex({ flexDirection: "column", ...style });

interface SlideProps {
  recap: Recap;
  covers: Covers;
  theme: Theme;
  /** Ícone da conquista mais rara, já em data URI. */
  achievementIcon: string | null;
}

export function SlideLayout({
  id,
  recap,
  covers,
  achievementIcon,
}: {
  id: RecapSlideId;
  recap: Recap;
  covers: Covers;
  achievementIcon: string | null;
}) {
  const theme = themes[id];
  const props: SlideProps = { recap, covers, theme, achievementIcon };
  return (
    <Root
      style={{
        backgroundColor: theme.bg,
        color: theme.fg,
        padding: `${u(28)}px ${u(20)}px ${u(20)}px`,
      }}
    >
      <div style={col({ flexGrow: 1, minHeight: 0 })}>{slideBody(id, props)}</div>
      <Footer recap={recap} theme={theme} />
    </Root>
  );
}

function slideBody(id: RecapSlideId, props: SlideProps): ReactNode {
  switch (id) {
    case "intro":
      return <IntroSlide {...props} />;
    case "games":
      return <GamesSlide {...props} />;
    case "genres":
      return <GenresSlide {...props} />;
    case "discoveries":
      return <DiscoveriesSlide {...props} />;
    case "moments":
      return <MomentsSlide {...props} />;
    case "profile":
      return <ProfileSlide {...props} />;
    case "trophies":
      return <TrophiesSlide {...props} />;
    case "summary":
      return <SummarySlide {...props} />;
    case "empty":
      return <EmptySlide {...props} />;
  }
}

// ---------------------------------------------------------------------------
// Peças

/** Marca e período no rodapé: o slide sozinho ainda diz de onde veio. */
function Footer({ recap, theme }: { recap: Recap; theme: Theme }) {
  return (
    <div
      style={flex({
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: u(16),
        paddingTop: u(12),
        borderTop: `${u(2)}px solid ${alpha(theme.fg, 0.3)}`,
      })}
    >
      <div style={flex(displaySm)}>Zerômetro</div>
      <div style={{ ...textSm, ...dim }}>{footerPeriod(recap)}</div>
    </div>
  );
}

/** O rótulo pequeno em caixa alta (o `display-xs` da web). */
function Caps({ children, style }: { children: string; style?: CSSProperties }) {
  return <div style={{ ...displayXs, ...dim, ...style }}>{children}</div>;
}

/** "Semana de 9 a 15 de nov." / "Outubro de 2026". */
function footerPeriod(recap: Recap): string {
  const label = periodLabel(recap.period, recap.from, recap.to);
  return recap.period === "week" ? `Semana de ${label}` : label[0]!.toUpperCase() + label.slice(1);
}

function Kicker({ children }: { children: string }) {
  return <Caps>{children}</Caps>;
}

function Title({ children }: { children: ReactNode }) {
  return <div style={{ ...displayMd, marginTop: u(8) }}>{children}</div>;
}

/** Triângulo/seta desenhado (a fonte pixel não tem ▲ ▼ ▶). */
function Arrow({
  dir,
  size,
  style,
}: {
  dir: "up" | "down" | "same" | "right";
  size: number;
  style?: CSSProperties;
}) {
  const s = u(size);
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      style={{ marginRight: u(6), flexShrink: 0, ...style }}
    >
      {dir === "up" && <polygon points="0,22 12,2 24,22" fill="currentColor" />}
      {dir === "down" && <polygon points="0,2 24,2 12,22" fill="currentColor" />}
      {dir === "same" && <rect x="2" y="8" width="20" height="8" fill="currentColor" />}
      {dir === "right" && <polygon points="2,0 22,12 2,24" fill="currentColor" />}
    </svg>
  );
}

/** "12h 40min" com as horas grandes e os minutos menores. */
function BigTime({ minutes, style }: { minutes: number; style?: CSSProperties }) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return (
    <div style={flex({ alignItems: "baseline", fontFamily: PIXEL_FONT, lineHeight: 1, ...style })}>
      {h > 0 && <span style={{ fontSize: u(40) }}>{h}h</span>}
      {(m > 0 || h === 0) && (
        <span style={{ fontSize: u(h > 0 ? 20 : 40), marginLeft: h > 0 ? u(8) : 0 }}>{m}min</span>
      )}
    </div>
  );
}

function Bar({ ratio, theme }: { ratio: number; theme: Theme }) {
  return (
    <div style={flex({ height: u(8), backgroundColor: alpha(theme.fg, 0.2) })}>
      <div style={{ width: `${Math.max(ratio, 0.02) * 100}%`, backgroundColor: theme.fg }} />
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div style={col()}>
      <Caps>{label}</Caps>
      <div style={{ ...displayMd, marginTop: u(6) }}>{value}</div>
      {hint && <div style={{ ...textSm, ...dim, marginTop: u(4) }}>{hint}</div>}
    </div>
  );
}

/** Capas em três colunas (estreias e zerados). */
function CoverGrid<T extends { gameId: number; name: string; coverImageId: string | null }>({
  covers,
  games,
  caption,
}: {
  covers: Covers;
  games: T[];
  caption: (game: T) => string;
}) {
  // Largura útil de 400px (450 − padding), três colunas com 12px entre elas.
  const width = u((400 - 24) / 3);
  return (
    <div style={flex({ marginTop: u(12), gap: u(12) })}>
      {games.map((game) => (
        <div key={game.gameId} style={col({ width })}>
          <Cover covers={covers} imageId={game.coverImageId} name={game.name} width={width} />
          <div style={{ ...textSm, ...clamp(2), marginTop: u(8) }}>{game.name}</div>
          <div style={{ ...textSm, ...dim }}>{caption(game)}</div>
        </div>
      ))}
    </div>
  );
}

const ofPeriod = (recap: Recap) => (recap.period === "week" ? "da semana" : "do mês");
const inPeriod = (recap: Recap) => (recap.period === "week" ? "nesta semana" : "neste mês");
const partialNote = (recap: Recap) =>
  recap.period === "week"
    ? "Parcial: a semana ainda não acabou."
    : "Parcial: o mês ainda não acabou.";

// ---------------------------------------------------------------------------
// Slides

const weekdayLetters = ["S", "T", "Q", "Q", "S", "S", "D"];

function IntroSlide({ recap, theme }: SlideProps) {
  const { trend, text } = comparison(recap.period, recap.totalMinutes, recap.previousMinutes);
  const max = Math.max(...recap.daily.map((d) => d.minutes), 1);
  const isWeek = recap.period === "week";
  const gap = isWeek ? u(8) : u(1);
  const barsHeight = u(96);

  return (
    <>
      <Kicker>{recapKicker(recap.period, recap.from)}</Kicker>
      <div style={{ ...textLg, ...dim, marginTop: u(4) }}>
        {periodLabel(recap.period, recap.from, recap.to)}
      </div>

      <div style={col({ marginTop: "auto" })}>
        <Caps>Tempo jogado</Caps>
        <BigTime minutes={recap.totalMinutes} style={{ marginTop: u(12) }} />
        <div style={flex({ ...textLg, alignItems: "center", marginTop: u(12) })}>
          <Arrow dir={trend} size={12} />
          {text}
        </div>
      </div>

      <div style={col({ marginTop: u(24) })}>
        <div style={flex({ alignItems: "flex-end", height: barsHeight, gap })}>
          {recap.daily.map((day) => (
            <div
              key={day.date}
              style={{
                flexGrow: 1,
                flexBasis: 0,
                height: day.minutes > 0 ? (day.minutes / max) * barsHeight : u(3),
                backgroundColor:
                  day.date > recap.today
                    ? alpha(theme.fg, 0.1)
                    : day.minutes === 0
                      ? alpha(theme.fg, 0.25)
                      : theme.fg,
              }}
            />
          ))}
        </div>
        <div
          style={flex({
            ...font(PIXEL_FONT, 8, 12),
            ...dim,
            marginTop: u(6),
            gap: isWeek ? gap : 0,
            justifyContent: "space-between",
          })}
        >
          {isWeek
            ? recap.daily.map((day, i) => (
                <span
                  key={day.date}
                  style={{ flexGrow: 1, flexBasis: 0, display: "flex", justifyContent: "center" }}
                >
                  {weekdayLetters[i]}
                </span>
              ))
            : [recap.from, recap.to].map((d) => <span key={d}>{Number(d.slice(8))}</span>)}
        </div>
      </div>

      <div
        style={flex({
          marginTop: u(24),
          paddingTop: u(16),
          gap: u(12),
          borderTop: `${u(2)}px solid ${alpha(theme.fg, 0.3)}`,
        })}
      >
        <MiniStat label="Dias" value={`${recap.playedDays}/${recap.daily.length}`} />
        <MiniStat label="Sessões" value={recap.sessions} />
        <MiniStat label="Jogos" value={recap.gamesPlayed} />
      </div>
      {recap.inProgress && (
        <div style={{ ...textSm, ...dim, marginTop: u(12) }}>{partialNote(recap)}</div>
      )}
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={col({ flexGrow: 1, flexBasis: 0 })}>
      <Caps>{label}</Caps>
      <div style={{ ...displaySm, marginTop: u(6) }}>{value}</div>
    </div>
  );
}

function GamesSlide({ recap, covers }: SlideProps) {
  const [first, ...rest] = recap.topGames;
  if (!first) return null;
  return (
    <>
      <Kicker>Mais jogados</Kicker>
      <Title>Seu jogo {ofPeriod(recap)}</Title>

      <div style={flex({ marginTop: u(20), gap: u(16) })}>
        <Cover covers={covers} imageId={first.coverImageId} name={first.name} width={u(112)} />
        <div style={col({ flexGrow: 1, flexBasis: 0, minWidth: 0 })}>
          <Caps>#1</Caps>
          <div style={{ ...text2xl, ...clamp(3), marginTop: u(4) }}>{first.name}</div>
          <div style={{ ...displaySm, marginTop: u(8) }}>{formatMinutes(first.minutes)}</div>
          <div style={{ ...textSm, ...dim }}>{plural(first.sessions, "sessão", "sessões")}</div>
        </div>
      </div>

      {rest.length > 0 && (
        <div style={col({ marginTop: u(24), gap: u(12) })}>
          {rest.map((game, i) => (
            <div key={game.gameId} style={flex({ alignItems: "center", gap: u(12) })}>
              <div style={{ ...displaySm, width: u(20), flexShrink: 0 }}>{i + 2}</div>
              <Cover covers={covers} imageId={game.coverImageId} name={game.name} width={u(36)} />
              <div style={col({ flexGrow: 1, flexBasis: 0, minWidth: 0 })}>
                <div style={{ ...textLg, ...ellipsis }}>{game.name}</div>
                <div style={{ ...textSm, ...dim }}>{formatMinutes(game.minutes)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...textSm, ...dim, marginTop: "auto", paddingTop: u(16) }}>
        {plural(recap.gamesPlayed, "jogo diferente", "jogos diferentes")} {inPeriod(recap)}
      </div>
    </>
  );
}

function GenresSlide({ recap, theme }: SlideProps) {
  const [first] = recap.topGenres;
  if (!first) return null;
  return (
    <>
      <Kicker>Gêneros</Kicker>
      <Title>Você jogou muito</Title>
      <div style={{ ...font(PIXEL_FONT, 22, 28), marginTop: u(12) }}>{genreLabel(first.genre)}</div>

      <div style={col({ marginTop: u(32), gap: u(16) })}>
        {recap.topGenres.map((genre, i) => (
          <div key={genre.genre} style={col({ gap: u(6) })}>
            <div
              style={flex({ ...textLg, alignItems: "baseline", justifyContent: "space-between" })}
            >
              <div style={flex({ alignItems: "baseline", minWidth: 0, ...ellipsis })}>
                <span style={{ ...font(PIXEL_FONT, 10, 12), marginRight: u(8) }}>{i + 1}</span>
                {genreLabel(genre.genre)}
              </div>
              <span style={{ ...dim, flexShrink: 0, marginLeft: u(8) }}>
                {formatMinutes(genre.minutes)}
              </span>
            </div>
            <Bar ratio={genre.minutes / first.minutes} theme={theme} />
          </div>
        ))}
      </div>

      <div style={{ ...textSm, ...dim, marginTop: "auto", paddingTop: u(16) }}>
        Um jogo com vários gêneros conta em todos eles.
      </div>
    </>
  );
}

function DiscoveriesSlide({ recap, covers }: SlideProps) {
  const fresh = recap.newGames.slice(0, 3);
  const back = recap.returningGames.slice(0, 3);
  return (
    <>
      <Kicker>Estreias e retornos</Kicker>
      <Title>{fresh.length > 0 ? "Novidades no controle" : "Bem-vindos de volta"}</Title>

      <div style={col({ marginTop: "auto", marginBottom: "auto", gap: u(24) })}>
        {fresh.length > 0 && (
          <div style={col()}>
            <Caps>Primeira vez</Caps>
            <CoverGrid covers={covers} games={fresh} caption={(g) => formatMinutes(g.minutes)} />
            {recap.newGames.length > fresh.length && (
              <div style={{ ...textSm, ...dim, marginTop: u(8) }}>
                E mais {recap.newGames.length - fresh.length}.
              </div>
            )}
          </div>
        )}

        {back.length > 0 && (
          <div style={col()}>
            <Caps>De volta</Caps>
            <div style={col({ marginTop: u(12), gap: u(12) })}>
              {back.map((game) => (
                <div key={game.gameId} style={flex({ alignItems: "center", gap: u(12) })}>
                  <Cover
                    covers={covers}
                    imageId={game.coverImageId}
                    name={game.name}
                    width={u(36)}
                  />
                  <div style={col({ flexGrow: 1, flexBasis: 0, minWidth: 0 })}>
                    <div style={{ ...textLg, ...ellipsis }}>{game.name}</div>
                    <div style={{ ...textSm, ...dim }}>depois de {game.daysAway} dias parado</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function MomentsSlide({ recap }: SlideProps) {
  const { bestDay, longestSession, longestRun } = recap;
  return (
    <>
      <Kicker>Momentos</Kicker>
      <Title>Os destaques</Title>
      <div style={col({ marginTop: "auto", marginBottom: "auto", gap: u(28) })}>
        {bestDay && (
          <Fact
            label="Dia mais jogado"
            value={formatMinutes(bestDay.minutes)}
            hint={dayLabel(bestDay.date)}
          />
        )}
        {longestSession && (
          <Fact
            label="Maior sessão"
            value={formatMinutes(longestSession.minutes)}
            hint={longestSession.name}
          />
        )}
        {longestRun >= 2 && (
          <Fact
            label="Sequência"
            value={plural(longestRun, "dia", "dias")}
            hint="seguidos jogando"
          />
        )}
      </div>
    </>
  );
}

function ProfileSlide({ recap }: SlideProps) {
  return (
    <>
      <Kicker>Seu perfil</Kicker>
      <div style={{ ...displayLg, marginTop: "auto" }}>{profileTitle(recap.profile)}</div>
      <div style={col({ ...textXl, marginTop: u(24), gap: u(8) })}>
        {profileFacts(recap.profile).map((fact) => (
          <div key={fact} style={flex({ alignItems: "flex-start" })}>
            <Arrow dir="right" size={10} style={{ marginTop: u(9) }} />
            {fact}
          </div>
        ))}
      </div>
      <div style={{ ...textSm, ...dim, marginTop: "auto", paddingTop: u(16) }}>
        O horário vem das sessões de timer e da Steam.
      </div>
    </>
  );
}

const rarityFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
/** Abaixo disso, a conquista é rara de verdade: "só 4,2% dos jogadores". */
const RARE_PERCENT = 20;

function rarityText(rarity: number): string {
  const value = `${rarityFormat.format(rarity)}% dos jogadores`;
  return rarity < RARE_PERCENT ? `só ${value}` : `${value} têm`;
}

function TrophiesSlide({ recap, covers, theme, achievementIcon }: SlideProps) {
  const { finished, achievements } = recap;
  const shown = finished.slice(0, 3);
  const rarest = achievements.rarest;
  return (
    <>
      <Kicker>Troféus</Kicker>
      <Title>{finished.length > 0 ? "Missão cumprida" : "Conquistas"}</Title>

      <div style={col({ marginTop: "auto", marginBottom: "auto", gap: u(24) })}>
        {shown.length > 0 && (
          <div style={col()}>
            <Caps>{plural(finished.length, "jogo zerado", "jogos zerados")}</Caps>
            <CoverGrid
              covers={covers}
              games={shown}
              caption={(g) => completionTypeLabels[g.type]}
            />
          </div>
        )}

        {achievements.unlocked > 0 && (
          <div style={col()}>
            <Caps>
              {`${plural(achievements.unlocked, "conquista", "conquistas")} em ${plural(achievements.games, "jogo", "jogos")}`}
            </Caps>
            {rarest && (
              <div
                style={flex({
                  alignItems: "center",
                  gap: u(12),
                  marginTop: u(12),
                  padding: u(12),
                  backgroundColor: alpha(theme.fg, 0.1),
                })}
              >
                {achievementIcon && (
                  <img
                    alt=""
                    src={achievementIcon}
                    width={u(56)}
                    height={u(56)}
                    style={{ flexShrink: 0, border: `${u(2)}px solid ${theme.fg}` }}
                  />
                )}
                <div style={col({ flexGrow: 1, flexBasis: 0, minWidth: 0 })}>
                  <Caps>A mais rara</Caps>
                  <div style={{ ...textLg, ...clamp(2), marginTop: u(4) }}>{rarest.title}</div>
                  <div style={{ ...textSm, ...dim }}>
                    {rarest.gameName} · {rarityText(rarest.rarity)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function SummarySlide({ recap, covers }: SlideProps) {
  const [topGame] = recap.topGames;
  const [topGenre] = recap.topGenres;
  const stats: [string, ReactNode][] = [
    ["Tempo", formatMinutes(recap.totalMinutes)],
    ["Dias jogados", `${recap.playedDays}/${recap.daily.length}`],
    ["Gênero nº 1", topGenre ? genreLabel(topGenre.genre) : "—"],
    ["Jogos", recap.gamesPlayed],
    ["Zerados", recap.finished.length],
    ["Conquistas", recap.achievements.unlocked],
  ];
  return (
    <>
      <Kicker>{recapKicker(recap.period, recap.from)}</Kicker>
      <div style={{ ...textLg, ...dim, marginTop: u(4) }}>
        {periodLabel(recap.period, recap.from, recap.to)}
      </div>

      {topGame && (
        <div style={flex({ alignItems: "center", gap: u(16), marginTop: u(20) })}>
          <Cover covers={covers} imageId={topGame.coverImageId} name={topGame.name} width={u(80)} />
          <div style={col({ flexGrow: 1, flexBasis: 0, minWidth: 0 })}>
            <Caps>Jogo nº 1</Caps>
            <div style={{ ...textXl, ...clamp(2), marginTop: u(4) }}>{topGame.name}</div>
          </div>
        </div>
      )}

      <div style={flex({ flexWrap: "wrap", marginTop: u(24), rowGap: u(20), columnGap: u(16) })}>
        {stats.map(([label, value]) => (
          <div key={label} style={col({ width: u((400 - 16) / 2), minWidth: 0 })}>
            <Caps style={{ opacity: 1, color: C.muted }}>{label}</Caps>
            <div style={{ ...textXl, ...ellipsis, marginTop: u(4) }}>{value}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function EmptySlide({ recap }: SlideProps) {
  const isWeek = recap.period === "week";
  return (
    <>
      <Kicker>{recapKicker(recap.period, recap.from)}</Kicker>
      <div style={{ ...textLg, ...dim, marginTop: u(4) }}>
        {periodLabel(recap.period, recap.from, recap.to)}
      </div>
      <div style={{ ...displayMd, marginTop: "auto" }}>
        {isWeek ? "Nenhuma sessão nessa semana." : "Nenhuma sessão nesse mês."}
      </div>
      <div style={{ ...textXl, ...dim, marginTop: u(16), marginBottom: "auto" }}>
        {recap.inProgress
          ? `Ainda dá tempo: ${isWeek ? "a semana" : "o mês"} não acabou.`
          : "Os controles descansaram."}
      </div>
    </>
  );
}
