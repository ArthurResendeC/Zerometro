import type * as React from "react";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Seta pixelada (dois triângulos em degrau) desenhada no fundo do campo.
const arrow =
  "bg-[linear-gradient(45deg,transparent_50%,var(--foreground)_50%),linear-gradient(-45deg,transparent_50%,var(--foreground)_50%)] bg-[length:8px_8px,8px_8px] bg-[position:right_20px_center,right_12px_center] bg-no-repeat";

/** <select> nativo com o visual dos outros campos (melhor no celular que um popover). */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        fieldClassName,
        arrow,
        "h-11 cursor-pointer appearance-none py-1 pr-10 [&>option]:bg-popover",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
