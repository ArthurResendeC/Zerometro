import { useState } from "react";
import type { GameVideo } from "@shared/game-page";
import { PlayIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

// Vídeos do IGDB (YouTube). Embed leve: até o clique é só a miniatura, sem iframe nem cookies
// do YouTube; o player (youtube-nocookie) só carrega quando a pessoa quer assistir.

const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function Trailer({ videos, gameName }: { videos: GameVideo[]; gameName: string }) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const video = videos[current];
  if (!video) return null;

  return (
    <div className="max-w-3xl space-y-3">
      <div className="relative m-1 aspect-video overflow-hidden bg-black pixel-frame">
        {playing ? (
          <iframe
            key={video.youtubeId}
            src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0`}
            title={`${video.name} de ${gameName}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            // O player precisa de scripts e da própria origem; popups para o "assistir no
            // YouTube". A regra protege iframes da mesma origem do site (que poderiam tirar o
            // próprio sandbox); aqui a origem é outra (youtube-nocookie.com).
            // oxlint-disable-next-line react/iframe-missing-sandbox
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            className="absolute inset-0 size-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 cursor-pointer"
            aria-label={`Assistir: ${video.name} de ${gameName}`}
          >
            <img
              src={thumbnail(video.youtubeId)}
              alt=""
              loading="lazy"
              className="size-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
            />
            <span className="absolute inset-0 bg-scanlines opacity-30" />
            <span className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center bg-primary text-primary-foreground pixel-frame pixel-frame-ink pixel-drop group-hover:brightness-110 [&_svg]:size-6">
              <PlayIcon />
            </span>
            <span className="absolute bottom-3 left-3 bg-background/85 px-2 py-1 display-xs">
              {video.name}
            </span>
          </button>
        )}
      </div>

      {videos.length > 1 && (
        <ol className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
          {videos.map((v, i) => (
            <li key={v.youtubeId} className="w-36 shrink-0 snap-start sm:w-44">
              <button
                type="button"
                onClick={() => {
                  setCurrent(i);
                  setPlaying(true);
                }}
                aria-pressed={i === current}
                className="group flex w-full cursor-pointer flex-col gap-1.5 text-left"
              >
                <img
                  src={thumbnail(v.youtubeId)}
                  alt=""
                  loading="lazy"
                  className={cn(
                    "m-0.5 aspect-video w-[calc(100%-4px)] object-cover pixel-frame-thin",
                    i === current
                      ? "[--px-frame-color:var(--primary)]"
                      : "opacity-70 group-hover:opacity-100",
                  )}
                />
                <span
                  className={cn(
                    "line-clamp-2 text-sm leading-4",
                    i === current ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {v.name}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
