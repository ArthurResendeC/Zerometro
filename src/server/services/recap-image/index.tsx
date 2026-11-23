import type { ReactNode } from "react";
import { Resvg } from "@resvg/resvg-wasm";
import satori from "satori";
import { formatMinutes } from "../../../shared/format";
import { genreLabel } from "../../../shared/genres";
import { coverUrl } from "../../../shared/igdb";
import { type Recap, type RecapImageFormat, recapImageSizes } from "../../../shared/recap";
import { type RecapSlideId, recapSlides } from "../../../shared/recap-slides";
import { NotFoundError } from "../../errors";
import { periodLabel, plural, profileTitle, recapKicker } from "../../../shared/recap-text";
import { loadRecapAssets } from "./assets";
import {
  BigTime,
  C,
  Cover,
  type Covers,
  DailyBars,
  ellipsis,
  flex,
  Label,
  type LayoutProps,
  Logo,
  pixel,
  Root,
  text,
  Trend,
} from "./parts";
import { SlideLayout } from "./slides";

// Imagens do recap para compartilhar, no visual do app (paleta escura do cartucho NES): a geral
// (stories 9:16 ou paisagem 16:9) e a de cada slide (stories). O Satori monta o SVG a partir do
// JSX e o resvg (wasm) converte em PNG. As capas e o ícone da conquista são baixados aqui e
// embutidos como data URI: o SVG não busca nada sozinho.

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface RecapImageRenderer {
  /** A imagem geral do recap. */
  render(recap: Recap, format: RecapImageFormat): Promise<Uint8Array<ArrayBuffer>>;
  /** Um slide do recap, em stories (9:16). */
  renderSlide(recap: Recap, slide: RecapSlideId): Promise<Uint8Array<ArrayBuffer>>;
}

interface RendererOptions {
  fetch?: FetchFn;
  /** Por imagem; sem resposta a tempo, entra o quadro com as iniciais. */
  timeoutMs?: number;
}

/** Imagens guardadas em memória (são poucas e não mudam). */
const MAX_CACHED_IMAGES = 200;

async function toPng(node: ReactNode, width: number, height: number) {
  const fonts = await loadRecapAssets();
  const svg = await satori(node, { width, height, fonts });
  // Cópia com um ArrayBuffer próprio (o que o Response/Hono aceita).
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng());
}

export function createRecapImageRenderer({
  fetch = globalThis.fetch,
  timeoutMs = 5000,
}: RendererOptions = {}): RecapImageRenderer {
  const cache = new Map<string, string>();

  async function loadImage(url: string): Promise<string | null> {
    const cached = cache.get(url);
    if (cached) return cached;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
      const data = `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
      if (cache.size >= MAX_CACHED_IMAGES) cache.delete(cache.keys().next().value!);
      cache.set(url, data);
      return data;
    } catch {
      return null;
    }
  }

  /** As capas dos jogos, por image id do IGDB (null = não veio: entra o quadro com as iniciais). */
  async function loadCovers(games: { coverImageId: string | null }[]): Promise<Covers> {
    const ids = [...new Set(games.map((g) => g.coverImageId).filter((id) => id !== null))];
    const loaded = await Promise.all(
      ids.map(async (id) => [id, await loadImage(coverUrl(id, "cover_big"))] as const),
    );
    return new Map(loaded);
  }

  return {
    async render(recap, format) {
      const covers = await loadCovers(recap.topGames);
      const { width, height } = recapImageSizes[format];
      const Layout = format === "story" ? StoryLayout : WideLayout;
      return toPng(<Layout recap={recap} covers={covers} />, width, height);
    },

    async renderSlide(recap, slide) {
      const [covers, icon] = await Promise.all([
        loadCovers([
          ...recap.topGames,
          ...recap.newGames,
          ...recap.returningGames,
          ...recap.finished,
        ]),
        recap.achievements.rarest?.iconUrl
          ? loadImage(recap.achievements.rarest.iconUrl)
          : Promise.resolve(null),
      ]);
      const { width, height } = recapImageSizes.story;
      return toPng(
        <SlideLayout id={slide} recap={recap} covers={covers} achievementIcon={icon} />,
        width,
        height,
      );
    },
  };
}

/** A imagem pedida: a de um slide (que precisa existir nesse recap) ou a geral, no formato. */
export function renderRecapImage(
  renderer: RecapImageRenderer,
  recap: Recap,
  { format, slide }: { format: RecapImageFormat; slide?: RecapSlideId },
): Promise<Uint8Array<ArrayBuffer>> {
  if (!slide) return renderer.render(recap, format);
  // Um slide sem dados no período não aparece no recap: também não vira imagem.
  if (!recapSlides(recap).includes(slide)) {
    throw new NotFoundError(`O slide "${slide}" não existe no recap desse período`);
  }
  return renderer.renderSlide(recap, slide);
}

// ---------------------------------------------------------------------------
// Peças da imagem geral

function Tile({
  label,
  value,
  size,
  grow = 1,
}: {
  label: string;
  value: ReactNode;
  size: number;
  grow?: number;
}) {
  return (
    <div
      style={flex({
        flexDirection: "column",
        flexGrow: grow,
        flexBasis: 0,
        minWidth: 0,
        backgroundColor: C.card,
        border: `4px solid ${C.border}`,
        padding: size * 0.5,
      })}
    >
      <Label size={size * 0.34} style={ellipsis}>
        {label}
      </Label>
      <div style={{ ...text(size), ...ellipsis, marginTop: size * 0.3 }}>{value}</div>
    </div>
  );
}

function tiles(recap: Recap) {
  const [genre] = recap.topGenres;
  const third =
    recap.finished.length > 0
      ? { label: "Zerados", value: String(recap.finished.length) }
      : { label: "Conquistas", value: String(recap.achievements.unlocked) };
  return [
    { label: "Dias", value: `${recap.playedDays}/${recap.daily.length}`, grow: 1 },
    { label: "Gênero nº 1", value: genre ? genreLabel(genre.genre) : "—", grow: 1.7 },
    { ...third, grow: 1.3 },
  ];
}

function Header({ recap, size }: { recap: Recap; size: number }) {
  return (
    <div style={flex({ flexDirection: "column" })}>
      <Label size={size * 0.45}>{recapKicker(recap.period, recap.from)}</Label>
      <div style={{ ...text(size), marginTop: size * 0.2 }}>
        {periodLabel(recap.period, recap.from, recap.to)}
      </div>
    </div>
  );
}

function ProfileBand({ recap, size }: { recap: Recap; size: number }) {
  const title = profileTitle(recap.profile);
  if (!title) return null;
  return (
    <div
      style={flex({
        ...pixel(size, C.bg),
        backgroundColor: C.yellow,
        padding: `${size * 0.6}px ${size * 0.8}px`,
        alignSelf: "flex-start",
      })}
    >
      {title}
    </div>
  );
}

function EmptyMessage({ recap, size }: { recap: Recap; size: number }) {
  return (
    <div style={flex({ flexDirection: "column", flexGrow: 1, justifyContent: "center" })}>
      <div style={pixel(size)}>
        {recap.period === "week" ? "Nenhuma sessão nessa semana." : "Nenhuma sessão nesse mês."}
      </div>
      <div style={{ ...text(size * 1.6, C.muted), marginTop: size }}>Os controles descansaram.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stories (1080×1920)

function StoryLayout({ recap, covers }: LayoutProps) {
  const [first, ...rest] = recap.topGames;
  return (
    <Root style={{ padding: 76 }}>
      <Logo size={40} />
      <div style={flex({ marginTop: 52 })}>
        <Header recap={recap} size={60} />
      </div>

      {recap.totalMinutes === 0 ? (
        <EmptyMessage recap={recap} size={36} />
      ) : (
        <>
          <div style={flex({ flexDirection: "column", marginTop: 44 })}>
            <Label size={26}>Tempo jogado</Label>
            <div style={flex({ marginTop: 24 })}>
              <BigTime minutes={recap.totalMinutes} size={120} />
            </div>
            <div style={flex({ marginTop: 20 })}>
              <Trend recap={recap} size={50} />
            </div>
          </div>

          <div style={flex({ marginTop: 36 })}>
            <DailyBars recap={recap} height={120} gap={recap.period === "week" ? 18 : 6} />
          </div>

          {first && (
            <div style={flex({ flexDirection: "column", marginTop: 48 })}>
              <Label size={26}>Mais jogados</Label>
              <div style={flex({ marginTop: 28, alignItems: "center" })}>
                <Cover covers={covers} imageId={first.coverImageId} name={first.name} width={176} />
                <div
                  style={flex({
                    flexDirection: "column",
                    marginLeft: 40,
                    flexGrow: 1,
                    flexBasis: 0,
                    minWidth: 0,
                  })}
                >
                  <div style={pixel(28, C.primary)}>#1</div>
                  <div style={{ ...text(72), marginTop: 12, lineClamp: 2, display: "block" }}>
                    {first.name}
                  </div>
                  <div style={{ ...pixel(34), marginTop: 18 }}>{formatMinutes(first.minutes)}</div>
                  <div style={{ ...text(44, C.muted), marginTop: 8 }}>
                    {plural(first.sessions, "sessão", "sessões")}
                  </div>
                </div>
              </div>
              <div style={flex({ flexDirection: "column", marginTop: 12 })}>
                {rest.map((game, i) => (
                  <div key={game.gameId} style={flex({ alignItems: "center", marginTop: 14 })}>
                    <div style={{ ...pixel(30, C.muted), width: 64 }}>{i + 2}</div>
                    <Cover
                      covers={covers}
                      imageId={game.coverImageId}
                      name={game.name}
                      width={60}
                    />
                    <div
                      style={{
                        ...text(52),
                        ...ellipsis,
                        marginLeft: 28,
                        flexGrow: 1,
                        flexBasis: 0,
                      }}
                    >
                      {game.name}
                    </div>
                    <div style={{ ...text(48, C.muted), marginLeft: 24 }}>
                      {formatMinutes(game.minutes)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={flex({ flexDirection: "column", marginTop: "auto", paddingTop: 28 })}>
            <ProfileBand recap={recap} size={26} />
            <div style={flex({ marginTop: 28, gap: 20 })}>
              {tiles(recap).map((tile) => (
                <Tile
                  key={tile.label}
                  label={tile.label}
                  value={tile.value}
                  size={52}
                  grow={tile.grow}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Root>
  );
}

// ---------------------------------------------------------------------------
// Paisagem 16:9 (1920×1080)

function WideLayout({ recap, covers }: LayoutProps) {
  const games = recap.topGames;
  const genres = recap.topGenres.slice(0, 3);
  const maxGenre = genres[0]?.minutes ?? 1;
  return (
    <Root style={{ padding: 64, flexDirection: "row" }}>
      <div style={flex({ flexDirection: "column", width: 720, flexShrink: 0 })}>
        <Logo size={34} />
        <div style={flex({ marginTop: 52 })}>
          <Header recap={recap} size={58} />
        </div>
        {recap.totalMinutes === 0 ? (
          <EmptyMessage recap={recap} size={30} />
        ) : (
          <>
            <div style={flex({ flexDirection: "column", marginTop: 48 })}>
              <Label size={22}>Tempo jogado</Label>
              <div style={flex({ marginTop: 20 })}>
                <BigTime minutes={recap.totalMinutes} size={104} />
              </div>
              <div style={flex({ marginTop: 18 })}>
                <Trend recap={recap} size={44} />
              </div>
            </div>
            <div style={flex({ marginTop: 40 })}>
              <DailyBars recap={recap} height={130} gap={recap.period === "week" ? 14 : 4} />
            </div>
            <div style={flex({ marginTop: "auto", gap: 16 })}>
              {tiles(recap).map((tile) => (
                <Tile
                  key={tile.label}
                  label={tile.label}
                  value={tile.value}
                  size={44}
                  grow={tile.grow}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {games.length > 0 && (
        <div style={flex({ flexDirection: "column", flexGrow: 1, marginLeft: 72, minWidth: 0 })}>
          <Label size={22}>Mais jogados</Label>
          <div style={flex({ marginTop: 28, gap: 26 })}>
            {games.map((game, i) => (
              <div key={game.gameId} style={flex({ flexDirection: "column", width: 168 })}>
                <Cover covers={covers} imageId={game.coverImageId} name={game.name} width={168} />
                <div
                  style={flex({
                    marginTop: 16,
                    alignItems: "center",
                    justifyContent: "space-between",
                  })}
                >
                  <span style={pixel(22, i === 0 ? C.primary : C.muted)}>#{i + 1}</span>
                  <span style={text(32, C.muted)}>{formatMinutes(game.minutes)}</span>
                </div>
                <div style={{ ...text(36), marginTop: 8, lineClamp: 2, display: "block" }}>
                  {game.name}
                </div>
              </div>
            ))}
          </div>

          {genres.length > 0 && (
            <div style={flex({ flexDirection: "column", marginTop: 48 })}>
              <Label size={22}>Gêneros</Label>
              {genres.map((genre) => (
                <div key={genre.genre} style={flex({ flexDirection: "column", marginTop: 22 })}>
                  <div style={flex({ justifyContent: "space-between", ...text(40) })}>
                    <span style={ellipsis}>{genreLabel(genre.genre)}</span>
                    <span style={{ color: C.muted, marginLeft: 20 }}>
                      {formatMinutes(genre.minutes)}
                    </span>
                  </div>
                  <div style={flex({ height: 14, marginTop: 8, backgroundColor: C.track })}>
                    <div
                      style={{
                        width: `${(genre.minutes / maxGenre) * 100}%`,
                        backgroundColor: C.primary,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={flex({ marginTop: "auto" })}>
            <ProfileBand recap={recap} size={22} />
          </div>
        </div>
      )}
    </Root>
  );
}
