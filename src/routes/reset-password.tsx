import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/coldcaller/brand";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Neues Passwort – Sign Selector Cold Caller" },
      { name: "description", content: "Neues Passwort für deinen Account festlegen." },
      { property: "og:title", content: "Neues Passwort – Sign Selector Cold Caller" },
      { property: "og:description", content: "Neues Passwort für deinen Account festlegen." },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setReady(true);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return toast.error("Die Passwörter stimmen nicht überein.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error("Fehler: " + error.message);
    toast.success("Passwort geändert.");
    nav({ to: "/dashboard" });
  }

  return (
    <div className="cc-theme cc-auth">
      <div className="cc-auth-form-wrap" style={{ gridColumn: "1 / -1" }}>
        <form onSubmit={submit} className="cc-auth-form">
          <div className="cc-brand"><Brand /></div>
          <header>
            <h1>Neues Passwort.</h1>
            <p>{ready ? "Lege dein neues Passwort fest." : "Öffne diese Seite über den Link aus der E-Mail."}</p>
          </header>
          <div>
            <Label htmlFor="p1">Neues Passwort</Label>
            <Input id="p1" type="password" autoComplete="new-password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy || !ready} />
          </div>
          <div>
            <Label htmlFor="p2">Passwort wiederholen</Label>
            <Input id="p2" type="password" autoComplete="new-password" minLength={6} required value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={busy || !ready} />
          </div>
          <Button type="submit" disabled={busy || !ready}>Passwort speichern</Button>
        </form>
      </div>
    </div>
  );
}
