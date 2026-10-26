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
  /** Realismus Render: `photo_path` is the building photo. */
  details?: Record<string, unknown> | null;
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
  /** False while the stage check against Pipedrive has not passed for this country; nothing is sent then. */
  validated?: boolean;
  /** Key of the custom deal field that stores the original caller, and the text to store in it. */
  originFieldKey?: string | null;
  originLabel?: string;
};
export type SyncStore = {
  /** Claims the action for syncing; null when it is already synced or being synced elsewhere. */
  begin(actionId: string): Promise<SyncContext | null>;
  saveLinks(leadId: string, country: string, links: Links): Promise<void>;
  /** A new deal exists: record it with the original caller and its first stage (history, customer assignment). */
  dealCreated?(ctx: SyncContext, links: Links): Promise<void>;
  /** An existing deal was moved by this tool. */
  stageMoved?(ctx: SyncContext, dealId: number, stageId: number): Promise<void>;
  markStep(actionId: string, step: "file" | "note" | "photo"): Promise<void>;
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

/** The building photo of a Realismus Render: GEBAEUDEFOTO.<ext>. */
export function photoFilename(path: string, contentType: string) {
  return logoFilename(path, contentType).replace(/^KONFI_LOGO/, "GEBAEUDEFOTO");
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
    if (ctx.validated === false) throw new CrmError("stages_not_validated");
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
      await store.stageMoved?.(ctx, links.deal_id, stageId!);
    } else {
      links.deal_id = await crm.createDeal({
        title: lead.company?.trim() || lead.contact_name?.trim() || "Neuer Lead",
        person_id: links.person_id,
        ...(links.organization_id ? { org_id: links.organization_id } : {}),
        stage_id: stageId,
        ...(ctx.originFieldKey && ctx.originLabel ? { [ctx.originFieldKey]: ctx.originLabel } : {}),
      });
      await save();
      await store.dealCreated?.(ctx, links);
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
    const photo = action.details?.["photo_path"];
    if (typeof photo === "string" && photo && !action.crm_steps["photo"]) {
      const file = await store.downloadLogo(photo);
      await crm.uploadFile(
        links.deal_id,
        photoFilename(photo, file.contentType),
        file.bytes,
        file.contentType,
      );
      await store.markStep(action.id, "photo");
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
  stages_not_validated:
    "Die Stage-Zuordnung wurde noch nicht gegen Pipedrive geprüft. Bitte unter Einstellungen → Stage Mapping „Stages prüfen“ ausführen.",
  logo_missing: "Das hochgeladene Logo wurde nicht gefunden.",
  invalid_payload: "Pipedrive hat die Daten abgelehnt.",
  unexpected_error: "Unerwarteter Fehler bei der Übertragung.",
};
export const crmErrorMessage = (code: string | null | undefined) =>
  (code && MESSAGES[code]) || (code ? "Die Übertragung an Pipedrive ist fehlgeschlagen." : "");
