import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles, ROLE_LABEL, type RoleName } from "@/lib/use-admin";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, auditDetail, type AuditAction } from "@/lib/audit-labels";
import { CountryCell } from "@/components/country-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dropdown } from "@/components/ui/dropdown";
import { AuditLocationDialog } from "@/components/audit-location-dialog";
import { isMasterEmail } from "@/lib/master";

export const Route = createFileRoute("/_authenticated/audit-log")({
  head: () => ({ meta: [{ title: "Aktivitätsprotokoll – Sign Selector Cold Caller" }] }),
  component: AuditLogPage,
});

const PAGE = 50;

type Entry = {
  id: string;
  created_at: string;
  actor_name: string;
  actor_email: string;
  actor_role: string;
  action: AuditAction;
  country: string | null;
  target_type: string | null;
  target_label: string | null;
  metadata: Record<string, unknown>;
};

function AuditLogPage() {
  const { user } = Route.useRouteContext();
  const roles = useRoles(user.id);
  const staff = roles.isStaff || roles.isGlobalAdmin;
  const [country, setCountry] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const master = isMasterEmail(user.email);

  const q = useInfiniteQuery({
    enabled: staff,
    queryKey: ["audit-log", country, action, actor, from, to],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from("activity_audit_logs")
        .select(
          "id,created_at,actor_name,actor_email,actor_role,action,country,target_type,target_label,metadata",
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE);
      if (pageParam) query = query.lt("created_at", pageParam);
      if (country) query = query.eq("country", country);
      if (action) query = query.eq("action", action as AuditAction);
      if (actor.trim()) {
        const t = actor.trim().replace(/[%,()]/g, " ");
        query = query.or(`actor_name.ilike.%${t}%,actor_email.ilike.%${t}%`);
      }
      if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
      if (to) query = query.lte("created_at", new Date(`${to}T23:59:59.999`).toISOString());
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Entry[];
    },
    getNextPageParam: (last) =>
      last.length === PAGE ? last[last.length - 1]?.created_at : undefined,
  });

  if (!roles.ready) return null;
  if (!staff)
    return (
      <p className="text-muted-foreground">Das Aktivitätsprotokoll ist nur für Admins und Manager.</p>
    );
  const rows = q.data?.pages.flat() ?? [];
  const fmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold">Aktivitätsprotokoll</h1>
        <p className="text-sm text-muted-foreground">
          Unveränderliches Protokoll aller wichtigen Aktionen, neueste zuerst. Einträge können weder
          bearbeitet noch gelöscht werden. Manager sehen nur Einträge ihres Landes.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Land
          <Dropdown
            ariaLabel="Land"
            value={country}
            onChange={setCountry}
            options={[
              { value: "", label: "Alle" },
              ...["DE", "AT", "NL", "ALL"].map((c) => ({
                value: c,
                label: c === "ALL" ? "Länderübergreifend" : c,
              })),
            ]}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Aktion
          <Dropdown
            ariaLabel="Aktion"
            value={action}
            onChange={setAction}
            options={[
              { value: "", label: "Alle" },
              ...AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] })),
            ]}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Benutzer
          <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Name oder E-Mail" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Von
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Bis
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Zeitpunkt</th>
              <th className="p-3">Benutzer</th>
              <th className="p-3">Aktion</th>
              <th className="p-3">Betrifft</th>
              <th className="p-3">Land</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const detail = auditDetail(r.action, r.metadata);
              return (
                <tr
                  key={r.id}
                  onClick={master ? () => setOpenId(r.id) : undefined}
                  className={master ? "cursor-pointer hover:bg-muted/50" : undefined}
                  title={master ? "Klicken für IP und Standort" : undefined}
                >
                  <td className="whitespace-nowrap p-3">{fmt.format(new Date(r.created_at))}</td>
                  <td className="p-3">
                    <div className="font-medium">{r.actor_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {ROLE_LABEL[r.actor_role as RoleName] ?? r.actor_role} · {r.actor_email}
                    </div>
                  </td>
                  <td className="p-3">{AUDIT_ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="p-3">
                    {r.target_label ?? "–"}
                    {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
                  </td>
                  <td className="p-3">
                    {r.country === "ALL" ? "Alle Länder" : <CountryCell code={r.country} />}
                  </td>
                </tr>
              );
            })}
            {!q.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Keine Einträge gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {master && <AuditLocationDialog id={openId} onClose={() => setOpenId(null)} />}
      {q.isError && <p className="text-sm text-destructive">Protokoll konnte nicht geladen werden.</p>}
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? "Lädt …" : "Mehr laden"}
        </Button>
      )}
    </div>
  );
}
