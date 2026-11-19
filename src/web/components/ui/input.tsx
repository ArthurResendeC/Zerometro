import type * as React from "react";
import { cn } from "@/lib/utils";

/** Visual comum dos campos (input, textarea, select nativo). */
export const fieldClassName =
  "w-full min-w-0 rounded-md border border-input bg-input/30 px-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/40 md:text-sm";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClassName, "h-9 py-1", className)}
      {...props}
    />
  );
}

export { Input };
