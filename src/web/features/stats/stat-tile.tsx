import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Um número em destaque, com o rótulo em cima e uma explicação curta embaixo. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
}) {
  return (
    <Card className="gap-2">
      <p className="display-xs text-muted-foreground">{label}</p>
      <p className="display-sm whitespace-nowrap sm:display-md">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}
