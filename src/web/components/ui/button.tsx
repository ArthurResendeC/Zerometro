import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Moldura, bisel e sombra são box-shadow (utilitários pixel-* em styles.css): não ocupam layout,
// por isso a margem frame-space-drop reserva o espaço da moldura e da sombra dura.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2.5 whitespace-nowrap rounded-control display-sm select-none frame-space-drop disabled:pointer-events-none disabled:pixel-disabled aria-invalid:[--px-frame-color:var(--destructive)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground pixel-frame pixel-frame-ink pixel-bevel pixel-drop [--px-shade:var(--primary-shade)] hover:brightness-110 active:pixel-press",
        destructive:
          "bg-destructive text-destructive-foreground pixel-frame pixel-frame-ink pixel-bevel pixel-drop [--px-shade:color-mix(in_srgb,var(--destructive)_60%,black)] hover:brightness-110 active:pixel-press",
        outline:
          "bg-background text-foreground pixel-frame pixel-frame-ink pixel-bevel pixel-drop [--px-shade:var(--muted)] hover:bg-accent active:pixel-press",
        secondary:
          "bg-secondary text-secondary-foreground pixel-frame pixel-frame-ink pixel-bevel pixel-drop [--px-shade:var(--background)] hover:brightness-110 active:pixel-press",
        ghost: "m-1 hover:bg-accent hover:text-accent-foreground active:translate-y-0.5",
        link: "m-0 font-sans text-base text-info underline decoration-2 underline-offset-4",
      },
      size: {
        default: "h-11 px-[18px]",
        sm: "h-9 gap-2 px-3 text-(length:--btn-sm-size) leading-(--btn-sm-lh)",
        lg: "h-13 px-6 text-(length:--btn-lg-size) leading-(--btn-lg-lh)",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
