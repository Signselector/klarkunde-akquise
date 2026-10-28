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
        .select("display_name,avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
  });
  const [name, setName] = useState("");
  useEffect(() => {
    if (profile) setName(profile.display_name ?? "");
  }, [profile]);
  const [currentPw, setCurrentPw] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const [avatarBusy, setAvatarBusy] = useState(false);
  async function changeAvatar(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Bitte ein JPG-, PNG- oder WebP-Bild wählen.");
      return;
    }
    setAvatarBusy(true);
    try {
      const blob = await squareJpeg(file, 256);
      const path = `${user.id}/avatar.jpg`;
      const up = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", user.id);
      if (error) throw error;
      toast.success("Profilbild gespeichert.");
      qc.invalidateQueries({ queryKey: ["me", user.id] });
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
    } catch {
      toast.error("Profilbild konnte nicht gespeichert werden.");
    } finally {
      setAvatarBusy(false);
    }
  }
  async function removeAvatar() {
    setAvatarBusy(true);
    await supabase.storage.from("avatars").remove([`${user.id}/avatar.jpg`]);
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", user.id);
    setAvatarBusy(false);
    if (error) {
      toast.error("Profilbild konnte nicht entfernt werden.");
      return;
    }
    qc.invalidateQueries({ queryKey: ["me", user.id] });
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (value.length < 2 || value.length > 80) {
      toast.error("Der Name muss 2 bis 80 Zeichen lang sein.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: value })
      .eq("id", user.id)
      .select("id");
    setBusy(false);
    if (error || !data?.length) {
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
    if (!currentPw) {
      toast.error("Bitte gib dein aktuelles Passwort ein.");
      return;
    }
    if (pw.length < 8) {
      toast.error("Das Passwort braucht mindestens 8 Zeichen.");
      return;
    }
    if (pw !== pw2) {
      toast.error("Die Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email ?? "",
      password: currentPw,
    });
    if (authError) {
      setBusy(false);
      toast.error("Das aktuelle Passwort ist falsch.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      toast.error("Passwort konnte nicht geändert werden.");
      return;
    }
    setCurrentPw("");
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
      <section className="flex items-center gap-4 rounded-lg border bg-card p-4">
        <span className="cc-avatar" style={{ width: 72, height: 72, fontSize: 22, flex: "none" }}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt={name} className="h-full w-full object-cover" />
          ) : (
            (name || user.email || "?").slice(0, 2).toUpperCase()
          )}
        </span>
        <div className="grid gap-2">
          <h2 className="font-semibold">Profilbild</h2>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" disabled={avatarBusy}>
              <label className="cursor-pointer">
                {avatarBusy ? "Lädt …" : "Bild hochladen"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={avatarBusy}
                  onChange={(e) => {
                    void changeAvatar(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            {profile?.avatar_url && (
              <Button variant="ghost" size="sm" disabled={avatarBusy} onClick={removeAvatar}>
                Entfernen
              </Button>
            )}
          </div>
        </div>
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
          <Label htmlFor="profile-current-pw">Aktuelles Passwort</Label>
          <Input
            id="profile-current-pw"
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
          />
        </div>
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
        <Button type="submit" disabled={busy || !pw || !currentPw}>
          Passwort ändern
        </Button>
      </form>
    </div>
  );
}

/** Center-crops to a square and re-encodes as JPEG, so uploads stay small whatever the original was. */
async function squareJpeg(file: File, size: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.88),
  );
}
