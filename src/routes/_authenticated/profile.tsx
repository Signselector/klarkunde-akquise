import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, useRoles } from "@/lib/use-admin";
import { isMasterEmail } from "@/lib/master";
import { COUNTRIES, useAllowedCountries } from "@/lib/country";
import { Flag } from "@/components/flag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Mein Profil – Sign Selector Cold Caller" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const roles = useRoles(user.id);
  const allowed = useAllowedCountries();
  const master = isMasterEmail(user.email);
  const { data: profile } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
  });
  const [name, setName] = useState("");
  useEffect(() => {
    if (profile) setName(profile.display_name ?? "");
  }, [profile]);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (value.length < 2 || value.length > 80) {
      toast.error("Der Name muss 2 bis 80 Zeichen lang sein.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: value })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error("Name konnte nicht gespeichert werden.");
      return;
    }
    toast.success("Name gespeichert.");
    qc.invalidateQueries({ queryKey: ["me", user.id] });
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
    qc.invalidateQueries({ queryKey: ["users"] });
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) {
      toast.error("Das Passwort braucht mindestens 8 Zeichen.");
      return;
    }
    if (pw !== pw2) {
      toast.error("Die Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      toast.error("Passwort konnte nicht geändert werden.");
      return;
    }
    setPw("");
    setPw2("");
    toast.success("Passwort geändert.");
  }

  const countries =
    master || roles.isGlobalAdmin ? COUNTRIES.map((c) => c.code) : (allowed.data ?? []);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-[22px] font-semibold">Mein Profil</h1>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Konto</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">E-Mail</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted-foreground">Rolle</dt>
          <dd>{master ? "Master-Admin" : roles.ready ? ROLE_LABEL[roles.role] : "…"}</dd>
          <dt className="text-muted-foreground">Länder</dt>
          <dd className="flex flex-wrap gap-3">
            {countries.length === 0 && <span>Noch kein Land freigeschaltet</span>}
            {countries.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5">
                <Flag code={c} size={18} /> {c}
              </span>
            ))}
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Rolle und Länder legen Manager bzw. Admins fest.
        </p>
      </section>
      <form onSubmit={saveName} className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Anzeigename</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <Button
          type="submit"
          disabled={busy || !name.trim() || name.trim() === profile?.display_name}
        >
          Speichern
        </Button>
      </form>
      <form onSubmit={savePassword} className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Passwort ändern</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-pw">Neues Passwort</Label>
          <Input
            id="profile-pw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-pw2">Passwort wiederholen</Label>
          <Input
            id="profile-pw2"
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" disabled={busy || !pw}>
          Passwort ändern
        </Button>
      </form>
    </div>
  );
}
