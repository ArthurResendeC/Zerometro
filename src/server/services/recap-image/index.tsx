import type { CSSProperties, ReactNode } from "react";
import { Resvg } from "@resvg/resvg-wasm";
import satori from "satori";
import { formatMinutes } from "../../../shared/format";
import { genreLabel } from "../../../shared/genres";
import { coverUrl } from "../../../shared/igdb";
import { type Recap, type RecapImageFormat, recapImageSizes } from "../../../shared/recap";
import {
  comparison,
  periodLabel,
  plural,
  profileTitle,
  recapKicker,
} from "../../../shared/recap-text";
import { loadRecapAssets, PIXEL_FONT, TEXT_FONT } from "./assets";

// Imagem do recap para compartilhar (stories 9:16 ou paisagem 16:9), no visual do app (paleta
// escura do cartucho NES). O Satori monta o SVG a partir do JSX (só flexbox, e toda div com mais
// de um filho precisa de display: flex) e o resvg (wasm) converte em PNG. As capas são baixadas
// aqui e embutidas como data URI: o SVG não busca nada sozinho.

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface RecapImageRenderer {
  render(recap: Recap, format: RecapImageFormat): Promise<Uint8Array<ArrayBuffer>>;
}

interface RendererOptions {
  fetch?: FetchFn;
  /** Por capa; sem resposta a tempo, entra o quadro com as iniciais. */
  timeoutMs?: number;
}

/** Capas guardadas em memória (são poucas e não mudam). */
const MAX_CACHED_COVERS = 200;

export function createRecapImageRenderer({
  fetch = globalThis.fetch,
  timeoutMs = 5000,
}: RendererOptions = {}): RecapImageRenderer {
  const covers = new Map<string, string>();

  async function loadCover(imageId: string): Promise<string | null> {
    const cached = covers.get(imageId);
    if (cached) return cached;
    try {
      const res = await fetch(coverUrl(imageId, "cover_big"), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
      const data = `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
      if (covers.size >= MAX_CACHED_COVERS) covers.delete(covers.keys().next().value!);
      covers.set(imageId, data);
      return data;
    } catch {
      return null;
    }
  }

  return {
    async render(recap, format) {
      const fonts = await loadRecapAssets();
      const ids = [
        ...new Set(recap.topGames.map((g) => g.coverImageId).filter((id) => id !== null)),
      ];
      const loaded = await Promise.all(ids.map(async (id) => [id, await loadCover(id)] as const));
      const images = new Map(loaded);
      const { width, height } = recapImageSizes[format];
      const Layout = format === "story" ? StoryLayout : WideLayout;
      const svg = await satori(<Layout recap={recap} covers={images} />, { width, height, fonts });
      // Cópia com um ArrayBuffer próprio (o que o Response/Hono aceita).
      return new Uint8Array(new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng());
    },
  };
}

// ---------------------------------------------------------------------------
// Paleta e peças

const C = {
  bg: "#0f0e17",
  card: "#1c1a29",
  fg: "#f4ecdc",
  muted: "#a39cb8",
  primary: "#ff7a1a",
  track: "#2b2840",
  border: "#7a7396",
  up: "#6bd66b",
  down: "#ff5d6c",
  yellow: "#ffd23f",
} as const;

type Covers = Map<string, string | null>;
interface LayoutProps {
  recap: Recap;
  covers: Covers;
}

const flex = (style: CSSProperties = {}): CSSProperties => ({ display: "flex", ...style });
const pixel = (size: number, color: string = C.fg): CSSProperties => ({
  fontFamily: PIXEL_FONT,
  fontSize: size,
  lineHeight: 1.25,
  color,
});
const text = (size: number, color: string = C.fg): CSSProperties => ({
  fontFamily: TEXT_FONT,
  fontSize: size,
  lineHeight: 1.05,
  color,
});
const ellipsis: CSSProperties = {
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

function Root({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={flex({
        width: "100%",
        height: "100%",
        // Sem isso, borda e padding somam à largura e o conteúdo sai da imagem.
        boxSizing: "border-box",
        flexDirection: "column",
        backgroundColor: C.bg,
        // Moldura do app: borda grossa e cantos retos.
        border: `12px solid ${C.border}`,
        ...style,
      })}
    >
      {children}
    </div>
  );
}

function Logo({ size }: { size: number }) {
  return (
    <div style={flex({ alignItems: "center", justifyContent: "space-between", width: "100%" })}>
      <div style={flex(pixel(size))}>
        Zer<span style={{ color: C.primary }}>ô</span>metro
      </div>
      <div
        style={flex({
          ...pixel(size * 0.6, C.primary),
          border: `4px solid ${C.primary}`,
          padding: `${size * 0.3}px ${size * 0.45}px`,
        })}
      >
        RECAP
      </div>
    </div>
  );
}

function Label({
  children,
  size,
  style,
}: {
  children: ReactNode;
  size: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={flex({
        ...pixel(size, C.muted),
        textTransform: "uppercase",
        letterSpacing: 1,
        ...style,
      })}
    >
      {children}
    </div>
  );
}

/** "46h 5min": horas grandes, minutos menores. */
function BigTime({ minutes, size }: { minutes: number; size: number }) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return (
    <div style={flex({ alignItems: "baseline" })}>
      {h > 0 && <span style={pixel(size, C.primary)}>{h}h</span>}
      {(m > 0 || h === 0) && (
        <span
          style={{
            ...pixel(h > 0 ? size * 0.45 : size, C.primary),
            marginLeft: h > 0 ? size * 0.2 : 0,
          }}
        >
          {m}min
        </span>
      )}
    </div>
  );
}

function Trend({ recap, size }: { recap: Recap; size: number }) {
  const { trend, text: line } = comparison(recap.period, recap.totalMinutes, recap.previousMinutes);
  const color = trend === "up" ? C.up : trend === "down" ? C.down : C.muted;
  const s = size * 0.5;
  return (
    <div style={flex({ alignItems: "center", ...text(size) })}>
      <svg width={s} height={s} viewBox="0 0 24 24" style={{ marginRight: size * 0.3 }}>
        {trend === "up" && <polygon points="0,22 12,2 24,22" fill={color} />}
        {trend === "down" && <polygon points="0,2 24,2 12,22" fill={color} />}
        {trend === "same" && <rect x="2" y="8" width="20" height="8" fill={color} />}
      </svg>
      {line}
      {recap.inProgress && (
        <span style={{ color: C.muted, marginLeft: size * 0.3 }}>(parcial)</span>
      )}
    </div>
  );
}

function DailyBars({ recap, height, gap }: { recap: Recap; height: number; gap: number }) {
  const max = Math.max(...recap.daily.map((d) => d.minutes), 1);
  return (
    <div style={flex({ alignItems: "flex-end", height, width: "100%" })}>
      {recap.daily.map((day, i) => (
        <div
          key={day.date}
          style={{
            flexGrow: 1,
            flexBasis: 0,
            marginLeft: i === 0 ? 0 : gap,
            height: day.minutes > 0 ? Math.max(6, (day.minutes / max) * height) : 6,
            backgroundColor:
              day.minutes > 0 ? C.primary : day.date > recap.today ? C.card : C.track,
          }}
        />
      ))}
    </div>
  );
}

function Cover({
  covers,
  imageId,
  name,
  width,
}: {
  covers: Covers;
  imageId: string | null;
  name: string;
  width: number;
}) {
  const height = Math.round((width * 4) / 3);
  const src = imageId ? covers.get(imageId) : null;
  const frame: CSSProperties = { width, height, border: `4px solid ${C.fg}`, flexShrink: 0 };
  if (src)
    return (
      <img
        alt={name}
        src={src}
        width={width}
        height={height}
        style={{ ...frame, objectFit: "cover" }}
      />
    );
  return (
    <div
      style={flex({
        ...frame,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: C.track,
      })}
    >
      <span style={pixel(Math.max(12, width / 5), C.muted)}>{initials(name)}</span>
    </div>
  );
}

function initials(name: string): string {
  const [first = "?", second] = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

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
