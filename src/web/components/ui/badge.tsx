import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "m-0.5 inline-flex w-fit shrink-0 items-center gap-1.5 overflow-hidden rounded-control px-1.5 py-1 display-xs whitespace-nowrap pixel-frame-thin [&>svg]:pointer-events-none [&>svg]:size-2.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [--px-frame-color:var(--primary)]",
        secondary: "bg-secondary text-secondary-foreground [--px-frame-color:var(--secondary)]",
        outline: "text-foreground",
        brand: "bg-primary text-primary-foreground [--px-frame-color:var(--primary)]",
        playing:
          "bg-status-playing text-status-playing-foreground [--px-frame-color:var(--status-playing)]",
        endless:
          "bg-status-endless text-status-endless-foreground [--px-frame-color:var(--status-endless)]",
        finished:
          "bg-status-finished text-status-finished-foreground [--px-frame-color:var(--status-finished)]",
        backlog:
          "bg-status-backlog text-status-backlog-foreground [--px-frame-color:var(--status-backlog)]",
        wishlist:
          "bg-status-wishlist text-status-wishlist-foreground [--px-frame-color:var(--status-wishlist)]",
        paused:
          "bg-status-paused text-status-paused-foreground [--px-frame-color:var(--status-paused)]",
        dropped:
          "bg-status-dropped text-status-dropped-foreground [--px-frame-color:var(--status-dropped)]",
        /** Conclusão 100% (dourado). */
        full: "bg-score-mixed text-score-mixed-foreground [--px-frame-color:var(--score-mixed)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
