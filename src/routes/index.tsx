import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
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
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <h1 className="font-display text-4xl font-bold sm:text-5xl">Cold Call Tool</h1>
      <p className="max-w-md text-muted-foreground">Leads importieren, strukturiert anrufen und jeden nächsten Schritt im Blick behalten.</p>
      <Button asChild size="lg"><Link to="/dashboard">Zum Tool</Link></Button>
    </div>
  );
}
