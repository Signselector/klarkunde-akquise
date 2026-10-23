import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Anmelden – Cold Call Tool" },
      { name: "description", content: "Anmeldung für Caller und Admins." },
      { property: "og:title", content: "Anmelden – Cold Call Tool" },
      { property: "og:description", content: "Anmeldung für Caller und Admins." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      setBusy(false);
      if (error) { toast.error("Anmeldung fehlgeschlagen: " + error.message); return; }
      nav({ to: "/dashboard" });
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password: pw,
        options: { emailRedirectTo: window.location.origin, data: { display_name: name } },
      });
      setBusy(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Bitte bestätige deine E-Mail über den Link im Postfach.");
      setMode("in");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-bold">Cold Call Tool</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "in" ? "Melde dich an." : "Neuen Caller-Account anlegen."}
          </p>
        </div>
        {mode === "up" && (
          <div className="space-y-1">
            <Label htmlFor="n">Name</Label>
            <Input id="n" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="e">E-Mail</Label>
          <Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="p">Passwort</Label>
          <Input id="p" type="password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        <Button className="w-full" disabled={busy}>
          {mode === "in" ? "Anmelden" : "Registrieren"}
        </Button>
        <button type="button" className="w-full text-sm text-muted-foreground underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Noch kein Account? Registrieren" : "Schon registriert? Anmelden"}
        </button>
      </form>
    </div>
  );
}
