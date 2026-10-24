import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  CircleAlert,
  Clock3,
  HelpCircle,
  LoaderCircle,
  Search,
  ShieldCheck,
} from "lucide-react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Presentation only: labels, values and permissions must be supplied by the caller. */
export function ActionButton({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button type="button" {...props} className={`cc-button cc-button--${variant} ${className}`} />
  );
}

export function InfoButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="cc-info" aria-label={`Information: ${label}`}>
          <HelpCircle size={18} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="cc-help" sideOffset={8} collisionPadding={16}>
          <strong>{label}</strong>
          <div>{children}</div>
          <Popover.Arrow className="cc-help-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`cc-badge cc-badge--${tone}`}>
      <span aria-hidden="true" className="cc-dot" />
      {children}
    </span>
  );
}

export type SyncState = "queued" | "synced" | "error" | "review";
const syncPresentation = {
  queued: {
    label: "Vorgemerkt",
    detail: "Noch nicht an Pipedrive übertragen.",
    tone: "neutral",
    icon: Clock3,
  },
  synced: {
    label: "Übertragen",
    detail: "Die Integration hat die Übertragung bestätigt.",
    tone: "success",
    icon: Check,
  },
  error: {
    label: "Sync fehlgeschlagen",
    detail: "Die Übertragung konnte nicht abgeschlossen werden.",
    tone: "danger",
    icon: CircleAlert,
  },
  review: {
    label: "Prüfung erforderlich",
    detail: "Die Zuordnung muss manuell geprüft werden.",
    tone: "warning",
    icon: ShieldCheck,
  },
} as const;
export function SyncIndicator({
  state,
  detail,
  onReview,
}: {
  state: SyncState;
  detail?: string;
  onReview?: () => void;
}) {
  const item = syncPresentation[state];
  return (
    <div className={`cc-sync cc-sync--${item.tone}`} role="status">
      <item.icon size={18} aria-hidden="true" />
      <span>
        <strong>{item.label}</strong>
        <small>{detail ?? item.detail}</small>
      </span>
      {onReview && (
        <ActionButton variant="secondary" onClick={onReview}>
          Details
        </ActionButton>
      )}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  context,
  help,
  icon,
}: {
  label: string;
  value: ReactNode;
  context: string;
  help: string;
  icon: ReactNode;
}) {
  return (
    <article className="cc-metric">
      <div className="cc-metric-label">
        <span>{label}</span>
        <InfoButton label={label}>{help}</InfoButton>
      </div>
      <div className="cc-metric-value">
        {value}
        <span className="cc-metric-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p>{context}</p>
    </article>
  );
}

export function Surface({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="cc-surface" aria-labelledby={id}>
      <header className="cc-section-heading">
        <div>
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function FeedbackState({
  kind,
  title,
  children,
  action,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "error" ? CircleAlert : Search;
  return (
    <div
      className={`cc-feedback cc-feedback--${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon size={30} aria-hidden="true" className={kind === "loading" ? "cc-spin" : ""} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
