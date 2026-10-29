import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Collapsible block for optional parts of a form. The body opens by animating the grid row from 0fr to 1fr (220 ms,
 * ease-out), so the content below moves smoothly. Closed content is inert, so it cannot be tabbed into.
 * `summary` is shown next to the title while collapsed (e.g. the chosen time).
 */
export function Reveal({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string | null;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="cc-reveal" data-open={open}>
      <button
        type="button"
        className="cc-reveal-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cc-reveal-title">{title}</span>
        {summary && !open && <span className="cc-reveal-summary">{summary}</span>}
        <ChevronDown className="cc-reveal-chevron" aria-hidden="true" />
      </button>
      <div id={id} className="cc-reveal-body" role="region" aria-label={title} {...(open ? {} : { inert: true })}>
        <div className="cc-reveal-inner">{children}</div>
      </div>
    </div>
  );
}
