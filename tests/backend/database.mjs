import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export async function schemaDatabase() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const f of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    // PGlite has no pg_cron: skip only the nightly schedule, the functions are still created.
    await db.exec(
      (await readFile(new URL("../../drizzle/migrations/" + f, import.meta.url), "utf8"))
        .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, "")
        .replace(/^SELECT cron\.schedule\(.*$/m, ""),
    );
  return db;
}
