import type * as React from "react";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** <select> nativo com o visual dos outros campos (melhor no celular que um popover). */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(fieldClassName, "h-9 cursor-pointer py-1 [&>option]:bg-popover", className)}
      {...props}
    />
  );
}

export { NativeSelect };
