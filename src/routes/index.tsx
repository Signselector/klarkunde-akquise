import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cold Call Tool – Lead-Management & Kaltakquise" },
      { name: "description", content: "Leads importieren, anrufen, Ergebnisse protokollieren – im Team." },
      { property: "og:title", content: "Cold Call Tool" },
      { property: "og:description", content: "Leads importieren, anrufen, Ergebnisse protokollieren – im Team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/dashboard" : "/auth", replace: true });
  },
  component: () => null,
});
