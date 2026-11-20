import * as React from "react";
import { cn } from "@/lib/utils";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

// Carrossel do shadcn (Embla). Diferenças do original: ícones pixelados, rótulos em português e
// botões sem posição absoluta (quem usa decide onde ficam; no Descobrir, ao lado do título).

type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugin = UseCarouselParameters[1];

type CarouselProps = {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: CarouselApi) => void;
};

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: ReturnType<typeof useEmblaCarousel>[1];
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
} & CarouselProps;

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

function useCarousel() {
  const context = React.useContext(CarouselContext);

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />");
  }

  return context;
}

function Carousel({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === "horizontal" ? "x" : "y",
    },
    plugins,
  );
  // Lido direto do Embla, que avisa quando muda (select/reInit), em vez de copiado num estado.
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!api) return () => {};
      api.on("reInit", onChange).on("select", onChange);
      return () => {
        api.off("reInit", onChange).off("select", onChange);
      };
    },
    [api],
  );
  const canScrollPrev = React.useSyncExternalStore(
    subscribe,
    () => api?.canScrollPrev() ?? false,
    () => false,
  );
  const canScrollNext = React.useSyncExternalStore(
    subscribe,
    () => api?.canScrollNext() ?? false,
    () => false,
  );

  const scrollPrev = React.useCallback(() => {
    api?.scrollPrev();
  }, [api]);

  const scrollNext = React.useCallback(() => {
    api?.scrollNext();
  }, [api]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext],
  );

  React.useEffect(() => {
    if (!api || !setApi) return;
    setApi(api);
  }, [api, setApi]);

  const context = React.useMemo(
    () => ({
      carouselRef,
      api,
      opts,
      orientation,
      scrollPrev,
      scrollNext,
      canScrollPrev,
      canScrollNext,
    }),
    [carouselRef, api, opts, orientation, scrollPrev, scrollNext, canScrollPrev, canScrollNext],
  );

  return (
    <CarouselContext.Provider value={context}>
      {/* <section> com nome acessível (aria-label/aria-labelledby) vira landmark "region". */}
      <section
        onKeyDownCapture={handleKeyDown}
        className={cn("relative", className)}
        aria-roledescription="carousel"
        data-slot="carousel"
        {...props}
      >
        {children}
      </section>
    </CarouselContext.Provider>
  );
}

function CarouselContent({ className, ...props }: React.ComponentProps<"div">) {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div ref={carouselRef} className="overflow-hidden" data-slot="carousel-content">
      <div
        className={cn("flex", orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col", className)}
        {...props}
      />
    </div>
  );
}

function CarouselItem({ className, ...props }: React.ComponentProps<"div">) {
  const { orientation } = useCarousel();

  return (
    <div
      // Padrão de carrossel do WAI-ARIA: cada slide é um "group" com roledescription "slide".
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className,
      )}
      {...props}
    />
  );
}

function CarouselPrevious({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      data-slot="carousel-previous"
      variant={variant}
      size={size}
      className={cn(orientation === "vertical" && "rotate-90", className)}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ArrowLeftIcon />
      <span className="sr-only">Anteriores</span>
    </Button>
  );
}

function CarouselNext({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      data-slot="carousel-next"
      variant={variant}
      size={size}
      className={cn(orientation === "vertical" && "rotate-90", className)}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ArrowRightIcon />
      <span className="sr-only">Próximos</span>
    </Button>
  );
}

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  useCarousel,
};
