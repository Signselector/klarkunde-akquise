import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const admin = randomUUID(),
  anna = randomUUID(),
  ben = randomUUID(),
  chris = randomUUID();
const rpc = async (name, args = []) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
const as = async (id, role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec("SET ROLE " + role);
};
const sql = async (text, args = []) => {
  await db.exec("RESET ROLE");
  return db.query(text, args);
};
let batch;
const leads = [];
const event = (user, lead, status, at) =>
  sql(
    "insert into public.status_changes(lead_id,user_id,old_status,new_status,created_at) values ($1,$2,'open',$3,$4)",
    [lead, user, status, at],
  );

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    // PGlite has no pg_cron: skip only the nightly schedule, the functions are still created.
    const text = (
      await readFile(new URL("../../drizzle/migrations/" + file, import.meta.url), "utf8")
    )
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, "")
      .replace(/^SELECT cron\.schedule\(.*$/m, "");
    await db.exec(text);
  }
  await db.query(
    "insert into auth.users values ($1,'admin@example.test','{\"display_name\":\"Admin\"}'),($2,'anna@example.test','{\"display_name\":\"Anna\"}'),($3,'ben@example.test','{\"display_name\":\"Ben\"}'),($4,'chris@example.test','{\"display_name\":\"Chris\"}')",
    [admin, anna, ben, chris],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await db.query(
    "insert into public.user_countries(user_id,country) values ($1,'DE'),($2,'DE'),($3,'DE') on conflict do nothing",
    [admin, anna, ben],
  );
  batch = (
    await db.query(
      "insert into public.lead_batches(name,created_by,import_state,country) values ('Test DE',$1,'confirmed','DE') returning id",
      [admin],
    )
  ).rows[0].id;
  for (let i = 1; i <= 12; i++)
    leads.push(
      (
        await db.query(
          "insert into public.leads(batch_id,company,phone) values ($1,$2,$3) returning id",
          [batch, "Firma " + i, "+49 30 555" + i],
        )
      ).rows[0].id,
    );
});
after(() => db.close());

test("today counts every documented attempt, but distinct leads where leads are meant (Vienna day)", async () => {
  const day = "2026-09-15";
  // 15 Sept 00:30 Vienna = 14 Sept 22:30 UTC (belongs to the day), 16 Sept 00:10 Vienna = 15 Sept 22:10 UTC (does not).
  await event(anna, leads[0], "not_reached", "2026-09-14T22:30:00Z");
  await event(anna, leads[0], "no_interest", "2026-09-15T08:00:00Z");
  await event(anna, leads[1], "low_q", "2026-09-15T09:00:00Z");
  await event(anna, leads[1], "reference_mail", "2026-09-15T09:30:00Z");
  await event(anna, leads[2], "high_q", "2026-09-15T10:00:00Z");
  await event(anna, leads[3], "waiting_3d", "2026-09-15T11:00:00Z");
  await event(anna, leads[4], "not_reached", "2026-09-15T12:00:00Z");
  await event(anna, leads[4], "not_reached", "2026-09-15T12:30:00Z");
  await event(anna, leads[5], "open", "2026-09-15T13:00:00Z"); // a reopened lead is not an attempt
  await event(anna, leads[6], "low_q", "2026-09-15T22:10:00Z"); // next Vienna day
  await event(ben, leads[7], "low_q", "2026-09-15T09:00:00Z"); // somebody else
  await as(anna);
  const d = await rpc("get_caller_day", [day]);
  assert.equal(d.attempts, 8);
  assert.equal(d.total_leads, 5, "leads 0..4, each once");
  assert.equal(d.reached, 4, "distinct leads with any result but not_reached: 0,1,2,3");
  assert.equal(d.no_interest, 1);
  assert.equal(d.not_reached, 3);
  assert.equal(d.low_q, 1);
  assert.equal(d.high_q, 1);
  assert.equal(d.waiting_3d, 1);
  await as(ben);
  assert.equal((await rpc("get_caller_day", [day])).attempts, 1);
  await as(chris);
  assert.equal((await rpc("get_caller_day", [day])).attempts, 0, "no events is a real zero");
});

test("monthly quality counts each lead once, Low and High never overlap, and a finished month is stored", async () => {
  // August 2026 for Anna: 8 distinct processed leads, 3 qualified (lead 0 first low then high -> high, counted once).
  const at = (d, h = 9) =>
    `2026-08-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
  await event(anna, leads[0], "low_q", at(3));
  await event(anna, leads[0], "high_q", at(5));
  await event(anna, leads[0], "reference_mail", at(6));
  await event(anna, leads[1], "low_q", at(4));
  await event(anna, leads[2], "high_q", at(4));
  await event(anna, leads[3], "no_interest", at(7));
  await event(anna, leads[4], "not_reached", at(7));
  await event(anna, leads[4], "not_reached", at(8));
  await event(anna, leads[5], "callback", at(9));
  await event(anna, leads[6], "waiting_3d", at(9));
  await event(anna, leads[7], "on_hold", at(10));
  await event(anna, leads[8], "open", at(10)); // reopen: not processed
  await event(ben, leads[9], "high_q", at(10)); // another employee
  await as(anna);
  const q = await rpc("get_monthly_quality", ["2026-08-17"]);
  assert.equal(q.month, "2026-08-01");
  assert.equal(q.processed, 8);
  assert.equal(q.qualified, 3);
  assert.equal(q.high_q, 2);
  assert.equal(q.low_q, 1);
  assert.equal(q.per_100, 37.5);
  assert.equal(q.final, true);
  // The result is stored: later events or deletions do not change a finished month.
  await event(anna, leads[10], "low_q", at(20));
  await sql("delete from public.status_changes where lead_id=$1 and new_status='no_interest'", [
    leads[3],
  ]);
  await as(anna);
  const again = await rpc("get_monthly_quality", ["2026-08-01"]);
  assert.equal(again.processed, 8);
  assert.equal(again.per_100, 37.5);
  assert.equal(again.frozen_at, q.frozen_at);
  // Ben is evaluated on his own.
  await as(ben);
  const b = await rpc("get_monthly_quality", ["2026-08-01"]);
  assert.deepEqual([b.processed, b.qualified, b.per_100], [1, 1, 100]);
});

test("a month without leads has no value, the running month is not stored, the future is refused", async () => {
  await as(chris);
  const empty = await rpc("get_monthly_quality", ["2026-08-01"]);
  assert.equal(empty.processed, 0);
  assert.equal(empty.per_100, null);
  const now = (await db.query("select (now() at time zone 'Europe/Vienna')::date d")).rows[0].d;
  const current = new Date(now);
  const first = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-01`;
  await as(anna);
  const running = await rpc("get_monthly_quality", [first]);
  assert.equal(running.final, false);
  assert.equal(
    (await sql("select count(*)::int n from public.monthly_quality where month=$1", [first]))
      .rows[0].n,
    0,
  );
  const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  await as(anna);
  await assert.rejects(
    () =>
      rpc("get_monthly_quality", [
        `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`,
      ]),
    /invalid_month/,
  );
});

test("the nightly job freezes every employee once and cannot be called by employees", async () => {
  await event(chris, leads[11], "low_q", "2026-07-10T09:00:00Z");
  await event(ben, leads[11], "no_interest", "2026-07-11T09:00:00Z");
  await as(anna);
  await assert.rejects(() => rpc("freeze_monthly_quality", ["2026-07-01"]), /permission denied/);
  await as(null, "service_role");
  assert.equal(await rpc("freeze_monthly_quality", ["2026-07-01"]), 2);
  assert.equal(await rpc("freeze_monthly_quality", ["2026-07-01"]), 0, "idempotent");
  await assert.rejects(
    () => rpc("freeze_monthly_quality", [new Date().toISOString().slice(0, 10)]),
    /month_not_finished/,
  );
  await as(chris);
  assert.equal((await rpc("get_monthly_quality", ["2026-07-01"])).per_100, 100);
});

test("Team Management numbers are replaced, never added; only the service role writes", async () => {
  await as(anna);
  assert.equal(await rpc("get_team_metrics"), null, "nothing synced yet is reported as nothing");
  await assert.rejects(() => rpc("upsert_team_metrics", [JSON.stringify([])]), /permission denied/);
  await as(null, "service_role");
  const rows = [
    { email: "ANNA@example.test", period: "2026-09-12", lead_quality: 8.4, leads_contributed: 31 },
    { email: "nobody@example.test", period: "2026-09-01", lead_quality: 5, leads_contributed: 1 },
  ];
  assert.deepEqual(await rpc("upsert_team_metrics", [JSON.stringify(rows)]), {
    updated: 1,
    unmatched: ["nobody@example.test"],
  });
  await rpc("upsert_team_metrics", [JSON.stringify(rows)]);
  await rpc("upsert_team_metrics", [
    JSON.stringify([
      {
        email: "anna@example.test",
        period: "2026-09-01",
        lead_quality: 8.6,
        leads_contributed: 35,
      },
    ]),
  ]);
  await as(anna);
  const m = await rpc("get_team_metrics");
  assert.equal(m.leads_contributed, 35);
  assert.equal(m.lead_quality, 8.6);
  assert.equal(m.period, "2026-09-01");
  await as(ben);
  assert.equal(await rpc("get_team_metrics"), null, "others never see these numbers");
});

test("weekly ranking is empty until points exist, then ranks, shares places and keeps finished weeks", async () => {
  await as(anna);
  const empty = await rpc("get_weekly_ranking", ["2026-09-14"]);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.me, { rank: null, points: 0 });
  assert.equal(empty.final, true);
  const point = (user, points, at, source = randomUUID()) =>
    sql(
      "insert into public.points_ledger(user_id,points,reason,source_type,source_id,occurred_at) values ($1,$2,'test','lead_action',$3,$4)",
      [user, points, source, at],
    );
  // Week Mon 14 - Sun 20 Sept 2026. Sunday 23:30 Vienna belongs to it, Monday 00:10 Vienna does not.
  await point(anna, 30, "2026-09-14T08:00:00Z");
  await point(anna, 20, "2026-09-20T21:30:00Z");
  await point(ben, 50, "2026-09-16T08:00:00Z");
  await point(chris, 10, "2026-09-16T08:00:00Z");
  await point(chris, 5, "2026-09-20T22:10:00Z");
  await as(anna);
  const week = await rpc("get_weekly_ranking", ["2026-09-17"]);
  assert.equal(week.week_start, "2026-09-14");
  assert.deepEqual(
    week.rows.map((r) => [r.name, r.points, r.rank]),
    [
      ["Anna", 50, 1],
      ["Ben", 50, 1],
      ["Chris", 10, 3],
    ],
  );
  assert.deepEqual(week.me, { rank: 1, points: 50 });
  // Finished week is stored: later bookings cannot change it.
  await point(chris, 500, "2026-09-18T08:00:00Z");
  assert.equal((await rpc("get_weekly_ranking", ["2026-09-14"])).rows.at(-1).points, 10);
  await as(ben);
  assert.equal(
    (await rpc("get_weekly_ranking", ["2026-09-14"])).rows.find((r) => r.is_me).name,
    "Ben",
  );
  await assert.rejects(() => rpc("get_weekly_ranking", ["2999-01-01"]), /invalid_week/);
});

test("points and coins are separate and one source earns the same points only once", async () => {
  const source = randomUUID();
  await sql(
    "insert into public.points_ledger(user_id,points,reason,source_type,source_id) values ($1,10,'qualified','lead_action',$2)",
    [anna, source],
  );
  await assert.rejects(
    () =>
      sql(
        "insert into public.points_ledger(user_id,points,reason,source_type,source_id) values ($1,10,'qualified','lead_action',$2)",
        [anna, source],
      ),
    /duplicate key/,
  );
  await sql(
    "insert into public.coins_ledger(user_id,coins,reason,source_type,source_id) values ($1,5,'qualified','lead_action',$2)",
    [anna, source],
  );
  await as(anna);
  await assert.rejects(
    () =>
      db.query(
        "insert into public.points_ledger(user_id,points,reason,source_type) values ($1,99,'x','y')",
        [anna],
      ),
    /permission denied/,
  );
  assert.equal((await db.query("select count(*)::int n from public.coins_ledger")).rows[0].n, 1);
  await as(ben);
  assert.equal(
    (await db.query("select count(*)::int n from public.points_ledger where user_id<>$1", [ben]))
      .rows[0].n,
    0,
    "points of others are private; only the ranking shows names",
  );
});

test("batch progress counts distinct processed leads and survives release and re-taking", async () => {
  await sql("update public.leads set attempts=3 where id=$1", [leads[0]]); // many attempts: still one processed lead
  await sql("update public.leads set status='low_q',attempts=1 where id=$1", [leads[1]]);
  await sql("update public.leads set archived_at=now() where id=$1", [leads[11]]);
  await as(anna);
  await rpc("claim_batch", [batch]);
  const p = (await rpc("get_batch_progress")).find((b) => b.id === batch);
  assert.equal(p.total, 11, "archived leads are not counted");
  assert.equal(p.processed, 2);
  assert.equal(p.unprocessed, 9);
  assert.equal(p.assigned_name, "Anna");
  await as(ben);
  await assert.rejects(() => rpc("release_batch", [batch]), /forbidden/);
  await as(anna);
  assert.equal(
    (await rpc("release_batch", [batch])).assigned_to,
    null,
    "the owner can give a batch back",
  );
  await as(ben);
  await rpc("claim_batch", [batch]);
  assert.equal(
    (await rpc("get_batch_progress")).find((b) => b.id === batch).processed,
    2,
    "progress stays",
  );
});

test("only admins reassign a batch, and only to someone allowed to work in that country", async () => {
  await as(ben);
  await assert.rejects(() => rpc("reassign_batch", [batch, anna]), /forbidden/);
  await as(admin);
  await assert.rejects(() => rpc("reassign_batch", [batch, chris]), /invalid_assignee/);
  assert.equal((await rpc("reassign_batch", [batch, anna])).assigned_to, anna);
  assert.equal((await rpc("get_batch_progress")).find((b) => b.id === batch).assigned_name, "Anna");
});

test("the CRM state 'simulated' exists for test mode", async () => {
  const id = (await sql("select id from public.lead_actions limit 1")).rows[0]?.id;
  assert.equal(id, undefined, "no actions in this test");
  await sql(
    "insert into public.lead_actions(lead_id,user_id,action,crm_sync_state) values ($1,$2,'low_q','simulated')",
    [leads[0], anna],
  );
});
