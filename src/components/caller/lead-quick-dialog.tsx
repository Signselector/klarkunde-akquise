import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { LeadActions } from "@/components/caller/lead-actions";
import { LeadContactEditor } from "@/components/caller/lead-contact-editor";
import type { LeadIntent } from "@/components/caller/leads-table";
import { ACTION_LABEL } from "@/lib/lead-actions";

/**
 * Pop-up of the lead list: only the form of the clicked result (e.g. Logo Render: logo upload, appointment, note) or
 * only the form for the customer data. The customer file itself stays closed.
 */
export function LeadQuickDialog({
  leadId,
  intent,
  userId,
  onClose,
}: {
  leadId: string | null;
  intent: LeadIntent | null;
  userId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const open = !!leadId && !!intent;
  const lead = useQuery({
    enabled: open,
    queryKey: ["lead-quick", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const callerName = useQuery({
    enabled: open,
    queryKey: ["profile-name", userId],
    queryFn: async () =>
      (await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle()).data?.display_name ?? "",
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["leads"] });
    void qc.invalidateQueries({ queryKey: ["lead-list"] });
    void qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    void qc.invalidateQueries({ queryKey: ["lead-quick", leadId] });
    void qc.invalidateQueries({ queryKey: ["lead-callback-due"] });
  };
  const l = lead.data;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="cc-theme max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{l?.company || "Lead"}</DialogTitle>
          {intent?.action ? (
            <DialogDescription className="sr-only">{ACTION_LABEL[intent.action] ?? "Gesprächsergebnis"}</DialogDescription>
          ) : (
            <DialogDescription>Kundendaten bearbeiten</DialogDescription>
          )}
        </DialogHeader>
        {lead.isLoading && <FeedbackState kind="loading" title="Lead wird geladen" />}
        {!lead.isLoading && !l && (
          <FeedbackState kind="empty" title="Lead nicht mehr verfügbar">
            Die Liste wurde möglicherweise inzwischen geändert.
          </FeedbackState>
        )}
        {l && intent?.action && (
          <LeadActions
            key={`${l.id}-${intent.action}`}
            lead={l}
            single
            initialAction={intent.action}
            userId={userId}
            callerName={callerName.data ?? ""}
            onCancel={onClose}
            onDone={(summary) => {
              refresh();
              if (summary) {
                toast.success(summary);
                onClose();
              }
            }}
          />
        )}
        {l && intent?.edit && (
          <LeadContactEditor
            key={`${l.id}-${l.version}`}
            lead={l}
            startEditing
            onCancel={onClose}
            onSaved={() => {
              refresh();
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
