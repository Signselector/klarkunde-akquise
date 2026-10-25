import { describe, expect, it } from "vitest";
import {
  CrmError,
  crmErrorMessage,
  logoFilename,
  syncLeadAction,
  type Crm,
  type Links,
  type SyncContext,
  type SyncStore,
} from "@/lib/crm-sync";

function setup(
  overrides: Partial<SyncContext> = {},
  actionOverrides: Partial<SyncContext["action"]> = {},
) {
  const calls: string[] = [];
  const saved: Links[] = [];
  const steps: string[] = [];
  const finished: { state: string; error?: string | undefined }[] = [];
  let ids = 100;
  const ctx: SyncContext = {
    action: {
      id: "a1",
      lead_id: "l1",
      user_id: "u1",
      action: "low_q",
      note: "Möchte ein einfaches Logo",
      stage_key: "low_q",
      logo_path: "u1/l1/abc-logo.PNG",
      created_at: "2026-10-24T10:00:00Z",
      crm_steps: {},
      ...actionOverrides,
    },
    lead: {
      id: "l1",
      company: "Muster GmbH",
      contact_name: "Max Muster",
      email: "m@x.test",
      phone: "+49 1",
    },
    country: "DE",
    callerName: "Anna",
    stages: { low_q: 8, high_q: 9, waiting_3d: 7, on_hold: 30, reference_mail: 36 },
    links: {},
    ...overrides,
  };
  const store: SyncStore = {
    begin: async () => ctx,
    saveLinks: async (_l, _c, links) => void saved.push({ ...links }),
    markStep: async (_id, step) => void steps.push(step),
    downloadLogo: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }),
    finish: async (_id, state, error) => void finished.push({ state, error }),
  };
  const crm: Crm = {
    createOrganization: async (d) => (calls.push(`org:${d.name}`), ++ids),
    createPerson: async (d) => (calls.push(`person:${d["name"]}`), ++ids),
    createDeal: async (d) => (calls.push(`deal:${d["title"]}@${d["stage_id"]}`), ++ids),
    moveDeal: async (id, stage) => void calls.push(`move:${id}@${stage}`),
    addNote: async (id, text) => void calls.push(`note:${id}:${text.replace(/\n/g, "|")}`),
    uploadFile: async (id, name) => void calls.push(`file:${id}:${name}`),
  };
  return { ctx, store, crm, calls, saved, steps, finished };
}

describe("syncLeadAction", () => {
  it("creates organization, person and deal in the mapped stage with note and KONFI_LOGO", async () => {
    const t = setup();
    expect(await syncLeadAction("a1", t.store, t.crm)).toEqual({ state: "synced" });
    expect(t.calls).toEqual([
      "org:Muster GmbH",
      "person:Max Muster",
      "deal:Muster GmbH@8",
      expect.stringMatching(/^note:103:.*· Anna\|Möchte ein einfaches Logo$/),
      "file:103:KONFI_LOGO.png",
    ]);
    expect(t.saved.at(-1)).toEqual({ organization_id: 101, person_id: 102, deal_id: 103 });
    expect(t.steps).toEqual(["note", "file"]);
    expect(t.finished).toEqual([{ state: "synced", error: undefined }]);
  });

  it("reuses an existing deal and only moves it, without duplicating notes or the logo", async () => {
    const t = setup(
      { links: { organization_id: 1, person_id: 2, deal_id: 3 } },
      { action: "high_q", stage_key: "high_q", crm_steps: { note: true, file: true } },
    );
    await syncLeadAction("a1", t.store, t.crm);
    expect(t.calls).toEqual(["move:3@9"]);
  });

  it("does not create a person twice when only the deal failed earlier", async () => {
    const t = setup(
      { links: { organization_id: 1, person_id: 2 } },
      { logo_path: null, note: null },
    );
    await syncLeadAction("a1", t.store, t.crm);
    expect(t.calls).toEqual(["deal:Muster GmbH@8"]);
  });

  it("fails visibly when the stage is not configured and creates nothing", async () => {
    const t = setup({ stages: {} });
    expect(await syncLeadAction("a1", t.store, t.crm)).toEqual({
      state: "error",
      error: "stage_not_configured",
    });
    expect(t.calls).toEqual([]);
    expect(t.finished).toEqual([{ state: "error", error: "stage_not_configured" }]);
  });

  it("keeps what was created when the logo upload fails, so a retry only uploads the logo", async () => {
    const t = setup();
    t.crm.uploadFile = async () => {
      throw new CrmError("network_error");
    };
    expect(await syncLeadAction("a1", t.store, t.crm)).toEqual({
      state: "error",
      error: "network_error",
    });
    expect(t.saved.at(-1)).toEqual({ organization_id: 101, person_id: 102, deal_id: 103 });
    expect(t.steps).toEqual(["note"]);
  });

  it("skips actions that are already synced or running", async () => {
    const t = setup();
    t.store.begin = async () => null;
    expect(await syncLeadAction("a1", t.store, t.crm)).toEqual({ state: "skipped" });
    expect(t.calls).toEqual([]);
  });

  it("works without a company name and without a logo", async () => {
    const t = setup(
      { lead: { id: "l1", company: null, contact_name: "Max", email: null, phone: null } },
      { logo_path: null, stage_key: "waiting_3d", action: "waiting_3d" },
    );
    await syncLeadAction("a1", t.store, t.crm);
    expect(t.calls.filter((c) => c.startsWith("org:"))).toEqual([]);
    expect(t.calls).toContain("deal:Max@7");
  });
});

describe("helpers", () => {
  it("names the logo KONFI_LOGO with a safe extension", () => {
    expect(logoFilename("a/b/c-x.JPG", "image/jpeg")).toBe("KONFI_LOGO.jpg");
    expect(logoFilename("a/b/c-x", "application/pdf")).toBe("KONFI_LOGO.pdf");
    expect(logoFilename("a/b/c-x.exe", "text/plain")).toBe("KONFI_LOGO.png");
  });
  it("explains errors in German", () => {
    expect(crmErrorMessage("stage_not_configured")).toMatch(/Stage/);
    expect(crmErrorMessage(null)).toBe("");
  });
});
