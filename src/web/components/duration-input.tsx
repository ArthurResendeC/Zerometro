import { Input } from "@/components/ui/input";

interface DurationInputProps {
  label: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
  invalid: boolean;
}

/** Campo numérico curto com rótulo ao lado ("horas", "min"). */
export function DurationInput({ label, max, value, onChange, invalid }: DurationInputProps) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        onFocus={(e) => e.target.select()}
        aria-invalid={invalid}
        className="w-20 text-center"
      />
      {label}
    </label>
  );
}
