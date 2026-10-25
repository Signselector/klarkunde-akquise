/**
 * Pushes one recorded lead action to Pipedrive: organization, person and deal in the stage of the action,
 * the call note and (for the render actions) the customer logo as "KONFI_LOGO.<ext>".
 *
 * Pure logic with injected dependencies so it can be tested without Pipedrive or a database.
 * Retries are safe: what already exists is remembered (`links`, `steps`), so nothing is created twice.
 */
export type ActionRow = {
  id: string;
  lead_id: string;
  user_id: string;
  action: string;
  note: string | null;
  stage_key: string | null;
  logo_path: string | null;
  created_at: string;
  crm_steps: Record<string, boolean>;
};
export type LeadRow = {
  id: string;
  company: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
};
export type Links = {
  organization_id?: number | null;
  person_id?: number | null;
  deal_id?: number | null;
};
export type SyncContext = {
  action: ActionRow;
  lead: LeadRow;
  country: string;
  callerName: string;
  stages: Record<string, number>;
  links: Links;
};
export type SyncStore = {
  /** Claims the action for syncing; null when it is already synced or being synced elsewhere. */
  begin(actionId: string): Promise<SyncContext | null>;
  saveLinks(leadId: string, country: string, links: Links): Promise<void>;
  markStep(actionId: string, step: "file" | "note"): Promise<void>;
  downloadLogo(path: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  finish(actionId: string, state: "synced" | "error", error?: string): Promise<void>;
};
export interface Crm {
  createOrganization(data: { name: string }): Promise<number>;
  createPerson(data: Record<string, unknown>): Promise<number>;
  createDeal(data: Record<string, unknown>): Promise<number>;
  moveDeal(dealId: number, stageId: number): Promise<void>;
  addNote(dealId: number, content: string): Promise<void>;
  uploadFile(
    dealId: number,
    filename: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
}
export class CrmError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "svg", "pdf"]);
const BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

/** The file name the logo gets on the deal: KONFI_LOGO.<ext>. */
export function logoFilename(path: string, contentType: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return `KONFI_LOGO.${EXTENSIONS.has(ext) ? ext : (BY_TYPE[contentType] ?? "png")}`;
}

export function noteText(ctx: SyncContext) {
  const when = new Date(ctx.action.created_at).toLocaleString("de-DE", {
    timeZone: "Europe/Vienna",
  });
  return `${when} · ${ctx.callerName || "Caller"}\n${ctx.action.note ?? ""}`.trim();
}

export async function syncLeadAction(
  actionId: string,
  store: SyncStore,
  crm: Crm,
): Promise<{ state: "synced" | "error" | "skipped"; error?: string }> {
  const ctx = await store.begin(actionId);
  if (!ctx) return { state: "skipped" };
  try {
    const { action, lead, country } = ctx;
    const stageId = action.stage_key ? ctx.stages[action.stage_key] : undefined;
    if (!action.stage_key || !Number.isSafeInteger(stageId) || (stageId ?? 0) < 1)
      throw new CrmError("stage_not_configured");
    const links: Links = { ...ctx.links };
    const save = () => store.saveLinks(lead.id, country, links);

    if (!links.organization_id && lead.company?.trim()) {
      links.organization_id = await crm.createOrganization({ name: lead.company.trim() });
      await save();
    }
    if (!links.person_id) {
      links.person_id = await crm.createPerson({
        name: lead.contact_name?.trim() || lead.company?.trim() || "Unbekannt",
        ...(links.organization_id ? { org_id: links.organization_id } : {}),
        ...(lead.email ? { email: [{ value: lead.email, primary: true, label: "work" }] } : {}),
        ...(lead.phone ? { phone: [{ value: lead.phone, primary: true, label: "work" }] } : {}),
      });
      await save();
    }
    if (links.deal_id) {
      await crm.moveDeal(links.deal_id, stageId!);
    } else {
      links.deal_id = await crm.createDeal({
        title: lead.company?.trim() || lead.contact_name?.trim() || "Neuer Lead",
        person_id: links.person_id,
        ...(links.organization_id ? { org_id: links.organization_id } : {}),
        stage_id: stageId,
      });
      await save();
    }
    if (action.note && !action.crm_steps["note"]) {
      await crm.addNote(links.deal_id, noteText(ctx));
      await store.markStep(action.id, "note");
    }
    if (action.logo_path && !action.crm_steps["file"]) {
      const file = await store.downloadLogo(action.logo_path);
      await crm.uploadFile(
        links.deal_id,
        logoFilename(action.logo_path, file.contentType),
        file.bytes,
        file.contentType,
      );
      await store.markStep(action.id, "file");
    }
    await store.finish(action.id, "synced");
    return { state: "synced" };
  } catch (e) {
    const error = e instanceof CrmError ? e.code : "unexpected_error";
    await store.finish(actionId, "error", error);
    return { state: "error", error };
  }
}

const MESSAGES: Record<string, string> = {
  stage_not_configured:
    "Für diese Aktion ist keine Pipedrive-Stage zugeordnet (Einstellungen → Stage Mapping).",
  country_not_connected: "Für dieses Land ist kein Pipedrive-Konto verbunden.",
  not_configured: "Die Pipedrive-Verbindung ist nicht eingerichtet.",
  unauthorized: "Pipedrive hat die Anmeldung abgelehnt. Die Verbindung muss geprüft werden.",
  rate_limited: "Pipedrive ist gerade überlastet. Bitte in einer Minute erneut versuchen.",
  network_error: "Pipedrive war nicht erreichbar. Bitte erneut versuchen.",
  logo_missing: "Das hochgeladene Logo wurde nicht gefunden.",
  invalid_payload: "Pipedrive hat die Daten abgelehnt.",
  unexpected_error: "Unerwarteter Fehler bei der Übertragung.",
};
export const crmErrorMessage = (code: string | null | undefined) =>
  (code && MESSAGES[code]) || (code ? "Die Übertragung an Pipedrive ist fehlgeschlagen." : "");
