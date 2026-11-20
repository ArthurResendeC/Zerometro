import type { SVGProps } from "react";
import type { GameStatus } from "@shared/domain";
import { cn } from "@/lib/utils";

// Ícones pixelados do Zerômetro, desenhados numa grade 8×8 (o fogo, 8×10).
// Use em múltiplos de 8px (16px nos botões, 24px na navegação) para continuarem nítidos.

type IconProps = SVGProps<SVGSVGElement>;

/** Retângulo de `w`×`h` células na posição (x, y), como trecho de path. */
const r = (x: number, y: number, w = 1, h = 1) => `M${x} ${y}h${w}v${h}h-${w}z`;

function pixelIcon(d: string, displayName: string, fillRule?: "evenodd") {
  function Icon({ className, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 8 8"
        shapeRendering="crispEdges"
        aria-hidden
        className={cn("size-4 shrink-0", className)}
        {...props}
      >
        <path fill="currentColor" fillRule={fillRule} d={d} />
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

export const PlayIcon = pixelIcon(
  r(1, 0, 2, 8) + r(3, 1, 1, 6) + r(4, 2, 1, 4) + r(5, 3, 1, 2),
  "PlayIcon",
);
export const StopIcon = pixelIcon(r(1, 1, 6, 6), "StopIcon");
export const PauseIcon = pixelIcon(r(1, 1, 2, 6) + r(5, 1, 2, 6), "PauseIcon");
export const CloseIcon = pixelIcon(
  [0, 1, 2, 3, 4, 5].map((i) => r(i + 1, i + 1) + r(6 - i, i + 1)).join(""),
  "CloseIcon",
);
export const CheckIcon = pixelIcon(
  r(0, 4) +
    r(1, 4, 1, 2) +
    r(2, 5, 1, 2) +
    r(3, 4, 1, 2) +
    r(4, 3, 1, 2) +
    r(5, 2, 1, 2) +
    r(6, 1, 1, 2) +
    r(7, 1),
  "CheckIcon",
);
export const DownloadIcon = pixelIcon(
  r(3, 0, 2, 4) + r(1, 3, 6, 1) + r(2, 4, 4, 1) + r(3, 5, 2, 1) + r(0, 6) + r(7, 6) + r(0, 7, 8, 1),
  "DownloadIcon",
);
export const UploadIcon = pixelIcon(
  r(3, 0, 2, 1) + r(2, 1, 4, 1) + r(1, 2, 6, 1) + r(3, 3, 2, 3) + r(0, 6) + r(7, 6) + r(0, 7, 8, 1),
  "UploadIcon",
);
export const PlusIcon = pixelIcon(r(3, 0, 2, 8) + r(0, 3, 8, 2), "PlusIcon");
export const SearchIcon = pixelIcon(
  r(1, 0, 4, 1) + r(0, 1, 1, 4) + r(5, 1, 1, 4) + r(1, 5, 4, 1) + r(5, 5) + r(6, 6) + r(7, 7),
  "SearchIcon",
);
export const ListIcon = pixelIcon(
  r(0, 1) + r(2, 1, 6, 1) + r(0, 4) + r(2, 4, 6, 1) + r(0, 7) + r(2, 7, 6, 1),
  "ListIcon",
);
export const ChartIcon = pixelIcon(r(0, 4, 2, 4) + r(3, 1, 2, 7) + r(6, 3, 2, 5), "ChartIcon");
export const StarIcon = pixelIcon(
  r(3, 0, 2, 2) + r(0, 2, 8, 2) + r(1, 4, 6, 1) + r(2, 5, 4, 1) + r(1, 6, 2, 2) + r(5, 6, 2, 2),
  "StarIcon",
);
export const PencilIcon = pixelIcon(
  r(6, 0) +
    r(5, 1, 3, 1) +
    r(4, 2, 3, 1) +
    r(3, 3, 3, 1) +
    r(2, 4, 3, 1) +
    r(1, 5, 3, 1) +
    r(0, 6, 2, 2) +
    r(2, 6),
  "PencilIcon",
);
export const TrashIcon = pixelIcon(
  r(3, 0, 2, 1) +
    r(0, 1, 8, 1) +
    r(1, 2, 1, 6) +
    r(6, 2, 1, 6) +
    r(2, 7, 4, 1) +
    r(3, 3, 1, 3) +
    r(4, 3, 1, 3),
  "TrashIcon",
);
export const ArrowLeftIcon = pixelIcon(
  r(0, 3, 1, 2) + r(1, 2, 1, 4) + r(2, 1, 1, 6) + r(3, 3, 5, 2),
  "ArrowLeftIcon",
);
export const ArrowRightIcon = pixelIcon(
  r(7, 3, 1, 2) + r(6, 2, 1, 4) + r(5, 1, 1, 6) + r(0, 3, 5, 2),
  "ArrowRightIcon",
);
export const ArrowUpIcon = pixelIcon(
  r(3, 0, 2, 1) + r(2, 1, 4, 1) + r(1, 2, 6, 1) + r(3, 3, 2, 5),
  "ArrowUpIcon",
);
export const ArrowDownIcon = pixelIcon(
  r(3, 7, 2, 1) + r(2, 6, 4, 1) + r(1, 5, 6, 1) + r(3, 0, 2, 5),
  "ArrowDownIcon",
);
export const MinusIcon = pixelIcon(r(0, 3, 8, 2), "MinusIcon");
/** Seta saindo da caixa: link que abre outro site. */
export const ExternalIcon = pixelIcon(
  r(4, 0, 4, 1) +
    r(7, 1, 1, 3) +
    r(6, 1) +
    r(5, 2) +
    r(4, 3) +
    r(3, 4) +
    r(0, 1, 3, 1) +
    r(0, 2, 1, 6) +
    r(1, 7, 6, 1) +
    r(7, 5, 1, 3),
  "ExternalIcon",
);
export const TimerIcon = pixelIcon(
  r(2, 0, 4, 1) +
    r(1, 1) +
    r(6, 1) +
    r(0, 2, 1, 4) +
    r(7, 2, 1, 4) +
    r(1, 6) +
    r(6, 6) +
    r(2, 7, 4, 1) +
    r(3, 2, 1, 3) +
    r(4, 4, 2, 1),
  "TimerIcon",
);
export const CalendarIcon = pixelIcon(
  r(2, 0) + r(5, 0) + r(0, 1, 8, 2) + r(0, 3, 1, 5) + r(7, 3, 1, 5) + r(1, 7, 6, 1) + r(2, 4, 2, 2),
  "CalendarIcon",
);
export const SettingsIcon = pixelIcon(
  r(3, 0, 2) +
    r(1, 1, 6) +
    r(1, 2, 2) +
    r(5, 2, 2) +
    r(0, 3, 2, 2) +
    r(6, 3, 2, 2) +
    r(1, 5, 2) +
    r(5, 5, 2) +
    r(1, 6, 6) +
    r(3, 7, 2),
  "SettingsIcon",
);
export const LogOutIcon = pixelIcon(
  r(0, 0, 4, 1) +
    r(0, 1, 1, 6) +
    r(0, 7, 4, 1) +
    r(2, 3, 4, 2) +
    r(5, 1, 1, 6) +
    r(6, 2, 1, 4) +
    r(7, 3, 1, 2),
  "LogOutIcon",
);
export const GamepadIcon = pixelIcon(
  r(1, 2, 6, 4) + r(0, 3, 1, 4) + r(7, 3, 1, 4) + r(2, 3, 1, 1) + r(5, 4, 1, 1),
  "GamepadIcon",
  "evenodd",
);

/** Alto-falante (caixa + cone), base dos ícones de som. */
const speaker = r(0, 2, 2, 4) + r(2, 1, 1, 6) + r(3, 0, 1, 8);
export const VolumeOnIcon = pixelIcon(
  speaker + r(5, 3, 1, 2) + r(6, 1) + r(7, 2, 1, 4) + r(6, 6),
  "VolumeOnIcon",
);
export const VolumeOffIcon = pixelIcon(
  speaker + r(5, 2) + r(7, 2) + r(6, 3) + r(5, 4) + r(7, 4),
  "VolumeOffIcon",
);

const statusIcons: Record<GameStatus, ReturnType<typeof pixelIcon>> = {
  playing: PlayIcon,
  finished: CheckIcon,
  backlog: ListIcon,
  wishlist: StarIcon,
  paused: PauseIcon,
  dropped: CloseIcon,
};

/** Ícone de cada status da biblioteca (status nunca é só cor). */
export function StatusIcon({ status, ...props }: IconProps & { status: GameStatus }) {
  const Icon = statusIcons[status];
  return <Icon {...props} />;
}

/** Fogo da ofensiva (8×10). `lit` = aceso e tremulando; apagado fica cinza e parado. */
export function PixelFlame({ lit = true, className, ...props }: IconProps & { lit?: boolean }) {
  return (
    <svg
      viewBox="0 0 8 10"
      shapeRendering="crispEdges"
      aria-hidden
      className={cn("h-10 w-8 shrink-0 origin-bottom", lit && "animate-flicker", className)}
      {...props}
    >
      <path
        className={lit ? "fill-flame" : "fill-muted-foreground"}
        d={
          r(3, 0) +
          r(3, 1, 2, 1) +
          r(2, 2, 3, 1) +
          r(1, 3, 5, 2) +
          r(0, 5, 7, 4) +
          r(1, 9, 5, 1) +
          r(6, 2) +
          r(6, 3, 1, 2)
        }
      />
      <path className={lit ? "fill-flame-core" : "fill-muted"} d={r(3, 5, 2, 1) + r(2, 6, 3, 3)} />
    </svg>
  );
}
