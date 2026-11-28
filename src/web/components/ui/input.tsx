import type * as React from "react";
import { cn } from "@/lib/utils";

/** Visual comum dos campos (input, textarea, select nativo): moldura pixelada “funda”. */
export const fieldClassName =
  "frame-space w-[calc(100%-2*var(--frame-gap))] min-w-0 rounded-control border-0 bg-background px-3 text-base text-foreground pixel-frame pixel-sunken placeholder:text-muted-foreground aria-invalid:[--px-frame-color:var(--destructive)] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClassName, "h-11 py-1", className)}
      {...props}
    />
  );
}

export { Input };
