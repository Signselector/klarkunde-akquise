import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, LoaderCircle, Target, Zap } from "lucide-react";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Anmelden – KlarKunde" },
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
      if (error) {
        toast.error("Anmeldung fehlgeschlagen: " + error.message);
        return;
      }
      nav({ to: "/dashboard" });
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password: pw,
        options: { emailRedirectTo: window.location.origin, data: { display_name: name } },
      });
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Bitte bestätige deine E-Mail über den Link im Postfach.");
      setMode("in");
    }
  }

  return (
    <div className="cc-theme cc-auth">
      <aside className="cc-auth-story">
        <div className="cc-brand">
          <Zap size={32} fill="currentColor" />
          <span>
            KlarKunde<small>Dein nächster Abschluss.</small>
          </span>
        </div>
        <div>
          <span className="cc-auth-mark">
            <Target size={56} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2>Gute Gespräche. Klare Chancen.</h2>
          <p>
            Leads, Rückrufe und Kunden an einem Ort. Damit du dich auf dein nächstes Gespräch
            konzentrieren kannst.
          </p>
        </div>
        <small>Dein Arbeitsplatz für die Team-Akquise.</small>
      </aside>
      <div className="cc-auth-form-wrap">
        <form onSubmit={submit} className="cc-auth-form">
          <div className="cc-brand cc-auth-mobile-brand">
            <Zap size={30} fill="currentColor" />
            <span>
              KlarKunde<small>Dein nächster Abschluss.</small>
            </span>
          </div>
          <header>
            <h1>{mode === "in" ? "Willkommen zurück." : "Dein Start im Team."}</h1>
            <p>
              {mode === "in"
                ? "Melde dich an und starte dein nächstes Gespräch."
                : "Lege deinen Caller-Account an."}
            </p>
          </header>
          {mode === "up" && (
            <div>
              <Label htmlFor="n">Dein Name</Label>
              <Input
                id="n"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={busy}
              />
            </div>
          )}
          <div>
            <Label htmlFor="e">E-Mail</Label>
            <Input
              id="e"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
            />
          </div>
          <div>
            <Label htmlFor="p">Passwort</Label>
            <Input
              id="p"
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              minLength={6}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              disabled={busy}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="cc-spin" aria-hidden="true" />
                Bitte warten …
              </>
            ) : (
              <>
                {mode === "in" ? "Anmelden" : "Registrieren"}
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
          <button
            type="button"
            disabled={busy}
            className="cc-auth-mode"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
          >
            {mode === "in" ? "Neu im Team? Account erstellen" : "Schon registriert? Anmelden"}
          </button>
        </form>
      </div>
    </div>
  );
}
