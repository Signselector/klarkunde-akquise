const { chromium } = require(process.argv[2] || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const appOrigin = process.env.UI_TEST_URL || "http://127.0.0.1:4176";

(async () => {
  const out = path.resolve("docs/frontend/live-ui-screenshots");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "de-AT" });
  context.setDefaultTimeout(12000);
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "design@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { display_name: "Alex Beispiel" },
    created_at: "2026-10-20T08:00:00Z",
  };
  const token =
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url") +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        role: "authenticated",
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url") +
    ".local-test-signature";
  const session = {
    access_token: token,
    refresh_token: "local-test-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
  const a = {
    id: "22222222-2222-4222-8222-222222222222",
    batch_id: "44444444-4444-4444-8444-444444444444",
    company: "Musterwerk Architektur GmbH",
    contact_name: "Alex Beispiel",
    phone: "+43 000 000000",
    email: "kontakt@example.test",
    city: "Wien",
    extra: { Website: "musterwerk.example", Adresse: "Beispielgasse 12" },
    status: "open",
    attempts: 2,
    last_called_at: null,
    last_called_by: null,
    created_at: "2026-10-23T09:00:00Z",
  };
  const b = {
    ...a,
    id: "33333333-3333-4333-8333-333333333333",
    company: "Beispiel & Partner – Rückruf",
    contact_name: "Robin Muster",
    status: "callback",
  };
  const callback = {
    id: "55555555-5555-4555-8555-555555555555",
    lead_id: b.id,
    user_id: user.id,
    due_at: "2026-10-24T08:00:00Z",
    done: false,
    lead: b,
  };
  let failReads = false;
  let saveFails = false;
  let role = "admin";
  let reads = 0;
  const writes = [];
  const blocked = [];
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin === appOrigin) return route.continue();
    // All remote traffic is intercepted. No credentials or mutations reach a real backend.
    if (url.hostname === "fonts.googleapis.com")
      return route.fulfill({ contentType: "text/css", body: "" });
    if (url.pathname.includes("/auth/v1/")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(url.pathname.endsWith("/user") ? user : session),
      });
    }
    if (url.pathname.includes("/rest/v1/")) {
      reads++;
      if (req.method() !== "GET" && req.method() !== "HEAD") {
        writes.push({ pathname: url.pathname, body: req.postDataJSON(), method: req.method() });
        return route.fulfill({
          status: saveFails ? 500 : 200,
          contentType: "application/json",
          body: saveFails ? JSON.stringify({ message: "Simulated test failure" }) : "[]",
        });
      }
      if (failReads)
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Simulated read failure" }),
        });
      const table = url.pathname.split("/").at(-1);
      let data = [];
      if (table === "profiles")
        data = [{ id: user.id, display_name: "Alex Beispiel", email: user.email }];
      if (table === "user_roles") data = [{ user_id: user.id, role }];
      if (table === "lead_batches")
        data = [
          { id: a.batch_id, name: "Architektur · Österreich", created_at: "2026-10-23T09:00:00Z" },
        ];
      if (table === "app_settings") data = [];
      if (table === "callbacks") data = [callback];
      if (table === "leads") {
        data = [a, b];
        const id = url.searchParams.get("id");
        const status = url.searchParams.get("status");
        if (id) data = data.filter((x) => `eq.${x.id}` === id);
        if (status) data = data.filter((x) => `eq.${x.status}` === status);
        if (url.searchParams.get("or")?.includes("KEIN-TREFFER")) data = [];
        if (url.searchParams.get("limit") === "1") data = data.slice(0, 1);
      }
      if (table === "lead_notes")
        data = [
          {
            id: "note",
            lead_id: a.id,
            user_id: user.id,
            body: "Beispielnotiz aus dem bisherigen Gespräch.",
            created_at: "2026-10-23T10:00:00Z",
          },
        ];
      if (table === "status_changes")
        data = [
          {
            id: "event",
            lead_id: a.id,
            user_id: user.id,
            old_status: "open",
            new_status: "callback",
            created_at: "2026-10-23T10:00:00Z",
          },
        ];
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-expose-headers": "content-range",
          "content-range":
            req.method() === "HEAD"
              ? `*/${data.length}`
              : `0-${Math.max(0, data.length - 1)}/${data.length}`,
        },
        body: req.method() === "HEAD" ? "" : JSON.stringify(data),
      });
    }
    blocked.push(req.url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("browser-error", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console-error", m.text().slice(0, 200));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(appOrigin + "/auth");
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Willkommen zurück." }).waitFor();
  await page.screenshot({
    path: path.join(out, "login-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("E-Mail", { exact: true }).fill(user.email);
  await page.getByLabel("Passwort", { exact: true }).fill("Only-local-test-123");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();

  await page.getByRole("heading", { name: "Bereit für gute Gespräche." }).waitFor();
  await page.getByText("Architektur · Österreich", { exact: true }).waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: path.join(out, `dashboard-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `dashboard overflow ${width}`,
    );
  }
  // The real mobile navigation must close after selecting a destination.
  await page.getByRole("button", { name: "Navigation öffnen oder schließen" }).click();
  await page.getByRole("link", { name: "Leads", exact: true }).click();
  await page.getByRole("heading", { name: "Deine Lead-Zentrale." }).waitFor();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.screenshot({
    path: path.join(out, "leads-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Musterwerk Architektur GmbH öffnen" }).click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("textbox", { name: "Notizen", exact: true })
    .fill("Lead-Entwurf bleibt erhalten");
  await page.screenshot({ path: path.join(out, "lead-detail.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Musterwerk Architektur GmbH öffnen" }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Notizen", exact: true }).inputValue(),
    "Lead-Entwurf bleibt erhalten",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Leads durchsuchen" }).fill("KEIN-TREFFER");
  await page.getByRole("heading", { name: "Keine passenden Leads" }).waitFor();
  await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
  await page.getByRole("button", { name: "Musterwerk Architektur GmbH öffnen" }).waitFor();
  await page.getByRole("link", { name: "Anrufen", exact: true }).click();
  await page.getByRole("heading", { name: "Dein nächstes Gespräch." }).waitFor();
  await page
    .getByRole("textbox", { name: "Gesprächsnotiz", exact: true })
    .fill("Entwurf für offenen Lead");
  await page.getByRole("button", { name: "Fälligen Rückruf ansehen" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("textbox", { name: "Gesprächsnotiz", exact: true }).inputValue(),
    "Entwurf für offenen Lead",
  );
  await page.getByRole("button", { name: "Fälligen Rückruf ansehen" }).click();
  await page.getByRole("button", { name: "Rückruf im Arbeitsplatz öffnen", exact: true }).click();
  await page.getByRole("heading", { name: b.company, exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Gesprächsnotiz", exact: true }).inputValue(),
    "",
  );
  await page
    .getByRole("textbox", { name: "Gesprächsnotiz", exact: true })
    .fill("Entwurf für Rückruf");
  await page.getByRole("button", { name: "Zurück zum offenen Lead" }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Gesprächsnotiz", exact: true }).inputValue(),
    "Entwurf für offenen Lead",
  );
  assert.equal(await page.getByRole("button", { name: "Termin buchen", exact: true }).count(), 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: path.join(out, `call-clean-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  saveFails = true;
  await page.getByRole("button", { name: "Nicht erreicht", exact: true }).click();
  await page.getByText(/^Speichern fehlgeschlagen/).waitFor();
  await page.getByRole("button", { name: "Nicht erreicht", exact: true }).click();
  await page.getByText(/^Speichern fehlgeschlagen/).waitFor();
  const rpcWrites = writes.filter((x) => x.pathname.endsWith("/rpc/record_call_outcome"));
  if (rpcWrites.length) {
    assert.equal(rpcWrites.length, 2);
    assert.equal(rpcWrites[0].body.p_request_id, rpcWrites[1].body.p_request_id);
    assert.equal(rpcWrites[0].body.p_lead_id, a.id);
    assert.equal(rpcWrites[0].body.p_callback_id, undefined);
  }
  assert.equal(
    await page.getByRole("textbox", { name: "Gesprächsnotiz", exact: true }).inputValue(),
    "Entwurf für offenen Lead",
  );
  await page.getByRole("button", { name: "Rückruf planen", exact: true }).click();
  await page.getByLabel("Wann sollen wir zurückrufen?").fill("2026-10-25T14:30");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: path.join(out, `call-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `call overflow ${width}`,
    );
  }
  // Reload with a Caller fixture: admin-only navigation and delete action stay hidden.
  role = "caller";
  await page.goto(appOrigin + "/leads");
  await page.getByRole("heading", { name: "Deine Lead-Zentrale." }).waitFor();
  await page.getByRole("button", { name: "Musterwerk Architektur GmbH öffnen" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Accounts", exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Offene Leads löschen", exact: true }).count(),
    0,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(out, "leads-caller.png"),
    fullPage: true,
    animations: "disabled",
  });
  // Force data failures and verify that the page gives a useful retry action.
  failReads = true;
  await page.goto(appOrigin + "/leads");
  await page
    .getByRole("heading", { name: "Leads gerade nicht verfügbar" })
    .waitFor({ timeout: 20000 });
  assert(await page.getByRole("button", { name: "Erneut versuchen", exact: true }).isVisible());
  await page.screenshot({
    path: path.join(out, "leads-error.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(blocked.length, 0, JSON.stringify(blocked));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      pass: true,
      checks: [
        "actual login/dashboard/leads/call routes",
        "1440/768/390/320 no overflow",
        "mobile navigation closes",
        "lead detail draft survives Escape",
        "search and filter reset",
        "callback modal preserves note",
        "different lead drafts remain separate",
        "failed save retains note",
        "no appointment creation button",
        "Caller admin actions hidden",
        "read error with retry",
        "atomic retry key retained when enabled",
        "all remote traffic mocked",
      ],
      mockWrites: writes.length,
      reads,
      browserErrors: errors,
    }),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
