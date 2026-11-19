import type * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Card };
