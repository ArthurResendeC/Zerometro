// Gera os ícones PNG do app (manifest do PWA e tela inicial do iOS) a partir da chama em pixel art.
// Rodar só quando o desenho mudar (`mise run icons`); os PNGs ficam versionados.
import { mkdirSync } from "node:fs";
import sharp from "sharp";

// Mesma chama do PixelFlame (src/web/components/icons.tsx) e do favicon.svg: 7×10 células.
const FLAME_COLS = 7;
const FLAME_ROWS = 10;
const BACKGROUND = "#0f0e17";
const FLAME = "#ff7a1a";
const FLAME_CORE = "#ffd23f";
const flameCells: [x: number, y: number, w: number, h: number][] = [
  [3, 0, 1, 1],
  [3, 1, 2, 1],
  [2, 2, 3, 1],
  [1, 3, 5, 2],
  [0, 5, 7, 4],
  [1, 9, 5, 1],
  [6, 2, 1, 1],
  [6, 3, 1, 2],
];
const coreCells: [x: number, y: number, w: number, h: number][] = [
  [3, 5, 2, 1],
  [2, 6, 3, 3],
];

interface IconSpec {
  file: string;
  size: number;
  /** Tamanho de cada célula em px (inteiro, para a pixel art ficar nítida). */
  cell: number;
  /** Raio dos cantos do fundo; 0 = sangra até a borda (maskable e iOS, que aplicam a própria máscara). */
  radius: number;
}

const icons: IconSpec[] = [
  { file: "src/web/public/icons/icon-192.png", size: 192, cell: 12, radius: 30 },
  { file: "src/web/public/icons/icon-512.png", size: 512, cell: 32, radius: 79 },
  // Área segura do maskable: círculo de raio 40% (205px); a chama (196×280) cabe com folga.
  { file: "src/web/public/icons/icon-maskable-512.png", size: 512, cell: 28, radius: 0 },
  { file: "src/web/apple-touch-icon.png", size: 180, cell: 12, radius: 0 },
];

function iconSvg({ size, cell, radius }: IconSpec) {
  const left = Math.round((size - FLAME_COLS * cell) / 2);
  const top = Math.round((size - FLAME_ROWS * cell) / 2);
  const rects = (cells: typeof flameCells, fill: string) =>
    cells
      .map(
        ([x, y, w, h]) =>
          `<rect x="${left + x * cell}" y="${top + y * cell}" width="${w * cell}" height="${h * cell}" fill="${fill}"/>`,
      )
      .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${radius}" fill="${BACKGROUND}"/>
<g shape-rendering="crispEdges">${rects(flameCells, FLAME)}${rects(coreCells, FLAME_CORE)}</g>
</svg>`;
}

mkdirSync("src/web/public/icons", { recursive: true });
await Promise.all(
  icons.map(async (icon) => {
    await sharp(Buffer.from(iconSvg(icon)))
      .png({ compressionLevel: 9, palette: icon.radius === 0 })
      .toFile(icon.file);
    console.log(`${icon.file} (${icon.size}×${icon.size})`);
  }),
);
