import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
  /** Nome acessível de cada cursor (o Radix põe o role="slider" no cursor, não na raiz). */
  thumbLabel?: string;
}

/** Slider pixelado: trilho com moldura fina, faixa preenchida e cursor quadrado. */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabel,
  ...props
}: SliderProps) {
  const thumbs = (value ?? defaultValue ?? [min]).length;

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative m-0.5 h-3 grow overflow-hidden rounded-none bg-muted pixel-frame-thin [--px-frame-color:var(--foreground)]"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbs }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={thumbLabel}
          className="block size-5 shrink-0 cursor-grab rounded-none bg-background pixel-frame-thin [--px-frame-color:var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:cursor-grabbing data-[disabled]:cursor-not-allowed"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
