import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { COUNTRIES } from "@/lib/country";
import { Flag } from "@/components/flag";

/** Multi-select dropdown for the countries of an account; the list stays open while several are ticked. */
export function CountryDropdown({
  selected,
  onToggle,
  disabled,
  label,
}: {
  selected: string[];
  onToggle: (code: string, on: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        className="cc-dd-trigger"
        aria-label={`Länder von ${label}`}
      >
        <span className="cc-dd-value inline-flex items-center gap-2">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">Kein Land</span>
          ) : (
            COUNTRIES.filter((c) => selected.includes(c.code)).map((c) => (
              <span key={c.code} className="inline-flex items-center gap-1.5">
                <Flag code={c.code} size={18} /> {c.code}
              </span>
            ))
          )}
        </span>
        <ChevronDown className="cc-dd-chevron" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="cc-dd-content cc-dd-menu"
        >
          <div className="cc-dd-viewport">
            {COUNTRIES.map((c) => {
              const on = selected.includes(c.code);
              return (
                <Menu.CheckboxItem
                  key={c.code}
                  checked={on}
                  className="cc-dd-item"
                  data-state={on ? "checked" : "unchecked"}
                  onSelect={(e) => {
                    e.preventDefault();
                    onToggle(c.code, !on);
                  }}
                >
                  <Flag code={c.code} size={20} /> {c.label}
                  <Menu.ItemIndicator className="cc-dd-check">
                    <Check aria-hidden="true" />
                  </Menu.ItemIndicator>
                </Menu.CheckboxItem>
              );
            })}
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
