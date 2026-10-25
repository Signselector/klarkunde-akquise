import { DataQuality, PipedriveJobs } from "@/components/backend-status";
import { TemplateManager } from "@/components/template-manager";
import { BackupCenter } from "@/components/backup-center";
import { TestModeCard } from "@/components/TestMode";
import { StageMapping } from "@/components/stage-mapping";
import { backendEnabled } from "@/lib/backend";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SCRIPT } from "@/lib/leads";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Einstellungen – Sign Selector Cold Caller" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const { data: saved } = useQuery({
    queryKey: ["script"],
    queryFn: async () =>
      (await supabase.from("app_settings").select("value").eq("key", "call_script").maybeSingle())
        .data?.value,
  });
  useEffect(() => {
    if (saved) setScript(saved);
  }, [saved]);
  async function saveScript() {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "call_script", value: script, updated_at: new Date().toISOString() });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Leitfaden gespeichert.");
    qc.invalidateQueries({ queryKey: ["script"] });
  }
  if (!admin) return <p className="text-muted-foreground">Einstellungen sind nur für Admins.</p>;
  const isMaster = user.email?.toLowerCase() === "office@signselector.com";
  const tabs: [string, string][] = [
    ["pipedrive", "Pipedrive"],
    ["stages", "Stage Mapping"],
    ["dedup", "Deduplication"],
    ["email", "E-Mail"],
    ["sms", "SMS-Vorlagen"],
    ["script", "Leitfaden / Antwort zuordnen"],
    ...(isMaster ? [["backups", "Backups"] as [string, string]] : []),
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-semibold">Einstellungen</h1>
      <Tabs defaultValue="pipedrive" className="space-y-4">
        <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 rounded-full">
          {tabs.map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="rounded-full px-4">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="pipedrive" className="space-y-4">
          <SectionHeader
            title="Pipedrive"
            help="Verbindung, Testmodus und Übertragungen für 🇩🇪 DE und 🇦🇹 AT. Die API-Zugänge liegen serverseitig und werden nicht in der Datenbank gespeichert."
          />
          <TestModeCard />
          {backendEnabled && <PipedriveJobs admin={admin} />}
        </TabsContent>

        <TabsContent value="stages" className="space-y-4">
          <SectionHeader
            title="Stage Mapping"
            help="Ordne Ergebnisse den Pipedrive-Stages zu – getrennt für DE und AT."
          />
          <StageMapping />
        </TabsContent>

        <TabsContent value="dedup" className="space-y-4">
          <SectionHeader
            title="Deduplication"
            help="Beim Import werden mögliche Dubletten erkannt und hier als Datenqualitäts-Hinweise gelistet."
          />
          {backendEnabled ? (
            <DataQuality />
          ) : (
            <p className="text-sm text-muted-foreground">Backend nicht verbunden.</p>
          )}
        </TabsContent>

        <TabsContent value="email">
          <TemplateManager
            settingKey="email_templates"
            title="E-Mail-Vorlagen"
            help="Vorlagen für Mails nach dem Gespräch."
            withSubject
            defaults={[
              {
                id: "standard-ref",
                name: "Standard ref Mail",
                subject: "Unser Gespräch, {{firma}}",
                body: "Hallo {{ansprechpartner}},\n\nvielen Dank für das nette Gespräch.\n\nBeste Grüße\n{{caller}}",
              },
              {
                id: "kontakt",
                name: "Kontaktmail",
                subject: "Kontakt Sign Selector",
                body: "Hallo {{ansprechpartner}},\n\nwie besprochen melde ich mich bei Ihnen.\n\nBeste Grüße\n{{caller}}",
              },
              {
                id: "grundinteresse",
                name: "Grundinteresse",
                subject: "Ihr Interesse an Sign Selector",
                body: "Hallo {{ansprechpartner}},\n\nschön, dass Sie Interesse haben. Gerne senden wir Ihnen mehr Infos für {{firma}}.\n\nBeste Grüße\n{{caller}}",
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="sms">
          <TemplateManager
            settingKey="sms_templates"
            title="SMS-Vorlagen"
            help="Kurze Texte für SMS-Benachrichtigungen."
            defaults={[
              {
                id: "nicht-erreicht",
                name: "Nicht erreicht",
                body: "Hallo {{ansprechpartner}}, ich habe Sie leider nicht erreicht. Gruß {{caller}}",
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="script" className="space-y-4">
          <SectionHeader
            title="Leitfaden / Antwort zuordnen"
            help={`Gesprächsleitfaden für den Anruf-Ablauf. Platzhalter: {{firma}} {{ansprechpartner}} {{stadt}} {{caller}}`}
          />
          <section className="space-y-2 rounded-lg border bg-card p-4">
            <Textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} />
            <Button onClick={saveScript}>Speichern</Button>
          </section>
        </TabsContent>

        {isMaster && (
          <TabsContent value="backups" className="space-y-4">
            <SectionHeader
              title="Backups"
              help="7-Tage-Backup-Center mit Download und manueller Erstellung."
            />
            <BackupCenter />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function SectionHeader({ title, help }: { title: string; help: string }) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{help}</p>
    </div>
  );
}
