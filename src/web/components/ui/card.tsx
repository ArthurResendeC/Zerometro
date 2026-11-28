import type * as React from "react";
import { cn } from "@/lib/utils";

/** Superfície com moldura pixelada (box-shadow: precisa dos 4px de margem). */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "frame-space flex flex-col gap-4 rounded-md bg-card p-4 text-card-foreground pixel-frame",
        className,
      )}
      {...props}
    />
  );
}

export { Card };
