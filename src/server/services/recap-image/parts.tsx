import type { CSSProperties, ReactNode } from "react";
import type { Recap } from "../../../shared/recap";
import { comparison } from "../../../shared/recap-text";
import { PIXEL_FONT, TEXT_FONT } from "./assets";

// Paleta e peças das imagens do recap (a geral e a de cada slide). Lembrete do Satori: só flexbox,
// e toda div com mais de um filho precisa de display: flex.

export const C = {
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

export type Covers = Map<string, string | null>;
export interface LayoutProps {
  recap: Recap;
  covers: Covers;
}

export const flex = (style: CSSProperties = {}): CSSProperties => ({ display: "flex", ...style });
export const pixel = (size: number, color: string = C.fg): CSSProperties => ({
  fontFamily: PIXEL_FONT,
  fontSize: size,
  lineHeight: 1.25,
  color,
});
export const text = (size: number, color: string = C.fg): CSSProperties => ({
  fontFamily: TEXT_FONT,
  fontSize: size,
  lineHeight: 1.05,
  color,
});
export const ellipsis: CSSProperties = {
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

export function Root({ children, style }: { children: ReactNode; style?: CSSProperties }) {
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

export function Logo({ size }: { size: number }) {
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

export function Label({
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
export function BigTime({ minutes, size }: { minutes: number; size: number }) {
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

export function Trend({ recap, size }: { recap: Recap; size: number }) {
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

export function DailyBars({ recap, height, gap }: { recap: Recap; height: number; gap: number }) {
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

export function Cover({
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

export function initials(name: string): string {
  const [first = "?", second] = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}
