import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type DropdownOption = { value: string; label: string; disabled?: boolean };

// Radix items cannot carry an empty value, but "" is the natural "all / none" choice in this app.
const EMPTY = "__empty__";
const enc = (v: string) => (v === "" ? EMPTY : v);
const dec = (v: string) => (v === EMPTY ? "" : v);

/**
 * App-wide dropdown that replaces the native <select>: same value / onChange contract, keyboard and screen reader
 * support from Radix, and a panel that grows out of its trigger (see .cc-dd-* in saas.css).
 */
export function Dropdown({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  disabled,
  className,
  contentClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <SelectPrimitive.Root value={value === "" && !options.some((o) => o.value === "") ? "" : enc(value)} onValueChange={(v) => onChange(dec(v))} disabled={disabled ?? false}>
      <SelectPrimitive.Trigger aria-label={ariaLabel} className={cn("cc-dd-trigger", className)}>
        <span className="cc-dd-value">
          <SelectPrimitive.Value placeholder={placeholder ?? "Auswählen"} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="cc-dd-chevron" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className={cn("cc-dd-content", contentClassName)}
        >
          <SelectPrimitive.Viewport className="cc-dd-viewport">
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={enc(o.value)} disabled={o.disabled ?? false} className="cc-dd-item">
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="cc-dd-check">
                  <Check aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
