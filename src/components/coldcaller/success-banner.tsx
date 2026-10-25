import { Trophy, X } from "@/components/coldcaller/icons";

/** Parent supplies a confirmed event. Does not grant coins, infer a win or play audio. */
export function SuccessBanner({
  title,
  description,
  animationsEnabled,
  onDismiss,
}: {
  title: string;
  description: string;
  animationsEnabled: boolean;
  onDismiss: () => void;
}) {
  return (
    <aside className={`cc-success ${animationsEnabled ? "cc-success--animate" : ""}`} role="status">
      <span className="cc-success-icon" aria-hidden="true">
        <Trophy size={28} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className="cc-icon-button"
        aria-label="Erfolgsmeldung schließen"
        onClick={onDismiss}
      >
        <X size={20} />
      </button>
    </aside>
  );
}
