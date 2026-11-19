import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Avisos com moldura pixelada e sombra dura (sem blur, sem cantos arredondados). */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[360px] max-w-full items-start gap-3 m-1 mr-3 mb-3 px-4 py-3.5 bg-popover text-popover-foreground pixel-frame pixel-drop font-sans",
          title: "display-sm",
          description: "text-sm text-muted-foreground",
          icon: "size-6 grid shrink-0 place-items-center",
          success: "[&_[data-icon]]:bg-status-finished [&_[data-icon]]:text-background",
          error: "[&_[data-icon]]:bg-destructive [&_[data-icon]]:text-background",
          info: "[&_[data-icon]]:bg-info [&_[data-icon]]:text-background",
          actionButton: "display-xs bg-primary text-primary-foreground px-2 py-1",
          cancelButton: "display-xs bg-secondary text-secondary-foreground px-2 py-1",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
