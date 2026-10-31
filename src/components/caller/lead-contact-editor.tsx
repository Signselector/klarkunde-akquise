import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Pencil } from "@/components/coldcaller/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const WEBSITE_KEYS = ["website", "webseite", "web", "url"];
const ADDRESS_KEYS = ["adresse", "address", "anschrift"];

/** The imported value of the first matching column of `extra` (website and address are not own columns). */
function fromExtra(extra: unknown, names: string[]) {
  if (!extra || typeof extra !== "object") return "";
  for (const [k, v] of Object.entries(extra as Record<string, unknown>))
    if (names.includes(k.trim().toLowerCase()) && typeof v === "string") return v;
  return "";
}

const MESSAGES: Record<string, string> = {
  invalid_email: "Die E-Mail-Adresse ist ungültig.",
  stale_lead: "Der Lead wurde inzwischen geändert. Bitte erneut öffnen und versuchen.",
  not_your_lead: "Du darfst diesen Lead nicht bearbeiten.",
  lead_claimed: "Der Lead wird gerade von jemand anderem bearbeitet.",
};

/** Lets the caller correct the customer data right in the Kundenakte. */
export function LeadContactEditor({
  lead,
  onSaved,
  startEditing = false,
  onCancel,
}: {
  /** Called when the form is cancelled (pop-up of the lead list). */
  onCancel?: () => void;
  lead: Tables<"leads">;
  onSaved: () => void;
  /** Open the form right away ("Daten bearbeiten" in the lead list). */
  startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [busy, setBusy] = useState(false);
  const initial = () => ({
    company: lead.company ?? "",
    contact_name: lead.contact_name ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    website: fromExtra(lead.extra, WEBSITE_KEYS),
    address: fromExtra(lead.extra, ADDRESS_KEYS),
    city: lead.city ?? "",
  });
  const [form, setForm] = useState(initial);
  const set = (key: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("update_lead_contact", {
      p_lead_id: lead.id,
      p_expected_version: lead.version,
      p_contact: form,
    });
    setBusy(false);
    if (error) {
      const code = Object.keys(MESSAGES).find((k) => error.message.includes(k));
      toast.error(code ? MESSAGES[code]! : "Die Änderungen konnten nicht gespeichert werden.");
      return;
    }
    toast.success("Kundendaten gespeichert.");
    setEditing(false);
    onSaved();
  }

  if (!editing)
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-1 w-full justify-center gap-2.5 bg-white px-4 shadow-sm"
        onClick={() => {
          setForm(initial());
          setEditing(true);
        }}
      >
        <Pencil size={18} aria-hidden="true" />
        Kundendaten bearbeiten
      </Button>
    );

  const field = (key: keyof ReturnType<typeof initial>, label: string, type = "text") => (
    <label className="block text-sm">
      {label}
      <Input
        type={type}
        className="mt-1.5 focus-visible:ring-inset"
        value={form[key]}
        onChange={set(key)}
        maxLength={300}
        disabled={busy}
      />
    </label>
  );
  return (
    <form
      className="space-y-3 rounded-[10px] border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field("company", "Firma")}
        {field("contact_name", "Ansprechpartner")}
        {field("phone", "Telefon", "tel")}
        {field("email", "E-Mail", "email")}
        {field("website", "Website")}
        {field("address", "Adresse")}
        {field("city", "Ort")}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Wird gespeichert …" : "Speichern"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => {
            setEditing(false);
            onCancel?.();
          }}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
