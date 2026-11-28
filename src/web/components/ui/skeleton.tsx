import type * as React from "react";
import { cn } from "@/lib/utils";

/** Bloco de carregamento: pisca em quadros (parado com prefers-reduced-motion). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-blink rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
