import { type Avatar, avatars } from "@shared/auth";
import { cn } from "@/lib/utils";

// Avatares dos perfis: sprites 8×8 em pixel art, com a paleta do app. Cada letra é uma cor e o
// ponto é transparente (o fundo do quadrado aparece).

const palette: Record<string, string> = {
  o: "#ff7a1a", // laranja (a chama)
  y: "#ffd23f", // amarelo
  w: "#f4ecdc", // creme
  k: "#1c1a29", // tinta
  g: "#6bd66b", // verde
  s: "#c8c4d8", // aço
  b: "#8a5a2b", // madeira
  r: "#e8384f", // vermelho
  t: "#f0d9b5", // bege
  p: "#c49bff", // roxo
  a: "#9fd8ff", // vidro
  n: "#ff9ec4", // rosa
};

const sprites: Record<Avatar, string[]> = {
  flame: [
    "...o....",
    "..oo..o.",
    "..ooo.o.",
    ".ooyoo..",
    ".oyyyoo.",
    "ooyyyyoo",
    "ooywwyoo",
    ".oyyyyo.",
  ],
  ghost: [
    "..wwww..",
    ".wwwwww.",
    "wwkwwkww",
    "wwkwwkww",
    "wwwwwwww",
    "wwwnnwww",
    "wwwwwwww",
    "ww.ww.ww",
  ],
  slime: [
    "........",
    "...gg...",
    "..gggg..",
    ".gwgggg.",
    ".gkggkg.",
    "gggggggg",
    "gggggggg",
    ".gggggg.",
  ],
  sword: [
    "......ss",
    ".....sws",
    "....sws.",
    ".b.sws..",
    "..bss...",
    "..bb....",
    ".b..b...",
    "y.......",
  ],
  potion: [
    "...bb...",
    "...aa...",
    "...aa...",
    "..aaaa..",
    ".arrrra.",
    ".rrwrrr.",
    ".rrrrrr.",
    "..rrrr..",
  ],
  mushroom: [
    "..rrrr..",
    ".rwrrwr.",
    "rrrrrrrr",
    "rwrrrrwr",
    ".tttttt.",
    "..tktk..",
    "..tttt..",
    "..tttt..",
  ],
  skull: [
    ".wwwwww.",
    "wwwwwwww",
    "wkkwwkkw",
    "wkkwwkkw",
    "wwwkkwww",
    ".wwwwww.",
    ".wkwkwk.",
    "..wwww..",
  ],
  cat: [
    "o......o",
    "oo....oo",
    "oooooooo",
    "okooooko",
    "oooooooo",
    "ooonnooo",
    ".oooooo.",
    "..o..o..",
  ],
  star: [
    "...yy...",
    "...yy...",
    "yyyyyyyy",
    ".ykyyky.",
    "..yyyy..",
    ".yyyyyy.",
    ".yy..yy.",
    "y......y",
  ],
  heart: [
    ".rr..rr.",
    "rrrrrrrr",
    "rwrrrrrr",
    "rrrrrrrr",
    ".rrrrrr.",
    "..rrrr..",
    "...rr...",
    "........",
  ],
  controller: [
    "........",
    ".pppppp.",
    "pppppppp",
    "pkpppprp",
    "kkkppgpr",
    "pkpppgpp",
    "pp....pp",
    "p......p",
  ],
  crown: [
    "........",
    "y..yy..y",
    "yy.yy.yy",
    "yyyyyyyy",
    "yryyayry",
    "yyyyyyyy",
    "yyyyyyyy",
    "........",
  ],
};

/** Retângulos de cada cor do sprite, juntando os pixels vizinhos na mesma linha. */
function paths(sprite: string[]): { color: string; d: string }[] {
  const byColor = new Map<string, string>();
  sprite.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let w = 1;
      while (row[x + w] === ch) w++;
      if (ch !== ".") byColor.set(ch, `${byColor.get(ch) ?? ""}M${x} ${y}h${w}v1h-${w}z`);
      x += w;
    }
  });
  return [...byColor].map(([ch, d]) => ({ color: palette[ch] ?? "currentColor", d }));
}

const drawn = Object.fromEntries(avatars.map((id) => [id, paths(sprites[id])])) as Record<
  Avatar,
  { color: string; d: string }[]
>;

export const avatarLabels: Record<Avatar, string> = {
  flame: "Chama",
  ghost: "Fantasma",
  slime: "Slime",
  sword: "Espada",
  potion: "Poção",
  mushroom: "Cogumelo",
  skull: "Caveira",
  cat: "Gato",
  star: "Estrela",
  heart: "Coração",
  controller: "Controle",
  crown: "Coroa",
};

/** O avatar de um perfil, num quadrado com moldura (use tamanhos múltiplos de 8px). */
export function ProfileAvatar({
  avatar,
  className,
  label,
}: {
  avatar: Avatar;
  className?: string;
  /** Texto para leitores de tela; sem ele, o avatar é decorativo. */
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center bg-muted shadow-[0_0_0_2px_var(--border)]",
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 8 8" shapeRendering="crispEdges" className="size-3/4">
        {drawn[avatar].map(({ color, d }) => (
          <path key={color} fill={color} d={d} />
        ))}
      </svg>
    </span>
  );
}

/** Grade para escolher o avatar (radio buttons acessíveis). */
export function AvatarPicker({
  value,
  onChange,
  name = "avatar",
}: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
  name?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-6 gap-2">
      {avatars.map((id) => (
        <label
          key={id}
          className="flex cursor-pointer justify-center p-1 has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-primary"
          title={avatarLabels[id]}
        >
          <input
            type="radio"
            name={name}
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
            aria-label={avatarLabels[id]}
            className="sr-only"
          />
          <ProfileAvatar
            avatar={id}
            className={cn("size-10", value === id && "shadow-[0_0_0_2px_var(--primary)]")}
          />
        </label>
      ))}
    </div>
  );
}
