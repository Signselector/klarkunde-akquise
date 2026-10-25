import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import { Phone, X } from "@/components/coldcaller/icons-3d";
import { ActionButton, StatusBadge } from "./primitives";

export type CallbackPreview = {
  company: string;
  contact: string;
  phone: string;
  dueLabel: string;
  note?: string;
};

/** Controlled overlay. Never owns or resets the surrounding call draft. */
export function CallbackDialog({
  open,
  onOpenChange,
  callback,
  onCall,
  actionLabel = "Jetzt anrufen",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callback: CallbackPreview;
  onCall: () => void;
  actionLabel?: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cc-overlay" />
        <Dialog.Content
          className="cc-dialog"
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="cc-dialog-heading">
            <span className="cc-large-icon">
              <Phone size={26} />
            </span>
            <Dialog.Close asChild>
              <button className="cc-icon-button" aria-label="Rückruf schließen">
                <X size={22} />
              </button>
            </Dialog.Close>
          </div>
          <StatusBadge tone="warning">Rückruf fällig · {callback.dueLabel}</StatusBadge>
          <Dialog.Title>{callback.company}</Dialog.Title>
          <Dialog.Description>
            {callback.contact} · {callback.phone}. Deine aktuelle Anrufmaske bleibt im Hintergrund
            geöffnet.
          </Dialog.Description>
          {callback.note && <blockquote className="cc-note">{callback.note}</blockquote>}
          <div className="cc-dialog-actions">
            <Dialog.Close asChild>
              <ActionButton variant="secondary">Zurück zur Arbeit</ActionButton>
            </Dialog.Close>
            <ActionButton onClick={onCall}>
              <Phone size={18} />
              {actionLabel}
            </ActionButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
