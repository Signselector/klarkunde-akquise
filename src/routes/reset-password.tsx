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
  const [tokenHash, setTokenHash] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setTokenHash(q.get("token_hash") ?? "");
    setEmail(q.get("email") ?? "");
    if (window.location.hash.includes("type=recovery")) setReady(true);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const needCode = !ready && !tokenHash;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { toast.error("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    // Token is redeemed only now (on submit), so mail scanners that open the link can't burn it.
    if (!ready) {
      const v = tokenHash
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
        : await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "recovery" });
      if (v.error) { setBusy(false); toast.error("Link oder Code ist ungültig oder abgelaufen. Bitte neu anfordern."); return; }
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error("Fehler: " + error.message); return; }
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
            <p>{needCode ? "Gib deine E-Mail und den Code aus der Mail ein." : "Lege dein neues Passwort fest."}</p>
          </header>
          {needCode && (
            <>
              <div>
                <Label htmlFor="em">E-Mail</Label>
                <Input id="em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label htmlFor="cd">Code aus der E-Mail</Label>
                <Input id="cd" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="p1">Neues Passwort</Label>
            <Input id="p1" type="password" autoComplete="new-password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy} />
          </div>
          <div>
            <Label htmlFor="p2">Passwort wiederholen</Label>
            <Input id="p2" type="password" autoComplete="new-password" minLength={6} required value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={busy} />
          </div>
          <Button type="submit" disabled={busy}>Passwort speichern</Button>
        </form>
      </div>
    </div>
  );
}
