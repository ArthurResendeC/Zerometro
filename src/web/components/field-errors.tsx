/** Mensagens de erro de um campo do TanStack Form (strings ou issues do Zod). */
export function FieldErrors({ errors }: { errors: unknown[] }) {
  const messages = [
    ...new Set(
      errors
        .map((e) => (typeof e === "string" ? e : (e as { message?: string } | undefined)?.message))
        .filter(Boolean),
    ),
  ];
  if (messages.length === 0) return null;
  return (
    <p className="text-xs text-destructive">
      <span aria-hidden>✕ </span>
      {messages.join(" · ")}
    </p>
  );
}
