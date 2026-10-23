import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/offers")({
  head: () => ({ meta: [{ title: "Angebote – Cold Call Tool" }] }),
  component: OffersPage,
});

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const STATUS = { draft: "Entwurf", sent: "Gesendet", accepted: "Angenommen", rejected: "Abgelehnt" } as Record<string, string>;

function OffersPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Angebote</h1>
      <Tabs defaultValue="offers">
        <TabsList><TabsTrigger value="offers">Angebote</TabsTrigger><TabsTrigger value="customers">Kunden</TabsTrigger><TabsTrigger value="products">Produkte</TabsTrigger></TabsList>
        <TabsContent value="offers"><OfferList /></TabsContent>
        <TabsContent value="customers"><Customers /></TabsContent>
        <TabsContent value="products"><Products /></TabsContent>
      </Tabs>
    </div>
  );
}

type Item = { description: string; quantity: number; unit_price: number };

function OfferList() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Item[]>([{ description: "", quantity: 1, unit_price: 0 }]);
  const { data: offers } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => (await supabase.from("offers").select("*, customer:offer_customers(name), items:offer_items(quantity,unit_price,description)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: customers } = useQuery({ queryKey: ["offer-customers"], queryFn: async () => (await supabase.from("offer_customers").select("id,name").order("name")).data ?? [] });
  const { data: products } = useQuery({ queryKey: ["offer-products"], queryFn: async () => (await supabase.from("offer_products").select("*").order("name")).data ?? [] });

  const total = (it: Item[]) => it.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const upd = (idx: number, patch: Partial<Item>) => setItems((a) => a.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  async function create() {
    const valid = items.filter((i) => i.description.trim());
    if (!valid.length) { toast.error("Mindestens eine Position angeben."); return; }
    const number = `A-${new Date().getFullYear()}-${String((offers?.length ?? 0) + 1).padStart(4, "0")}-${Math.floor(Math.random() * 90 + 10)}`;
    const { data: o, error } = await supabase.from("offers").insert({ offer_number: number, customer_id: customerId || null, note: note || null, created_by: user.id }).select("id").single();
    if (error || !o) { toast.error(error?.message ?? "Fehler"); return; }
    const { error: e2 } = await supabase.from("offer_items").insert(valid.map((i) => ({ ...i, offer_id: o.id })));
    if (e2) { toast.error(e2.message); return; }
    toast.success(`Angebot ${number} erstellt.`);
    setCreating(false); setNote(""); setCustomerId(""); setItems([{ description: "", quantity: 1, unit_price: 0 }]);
    qc.invalidateQueries({ queryKey: ["offers"] });
  }
  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("offers").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["offers"] });
  }

  return (
    <div className="space-y-3 pt-3">
      <Button onClick={() => setCreating((c) => !c)}>{creating ? "Abbrechen" : "Neues Angebot"}</Button>
      {creating && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger><SelectValue placeholder="Kunde wählen …" /></SelectTrigger>
            <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_7rem] gap-2">
              <div className="space-y-1">
                <Input placeholder="Position" value={it.description} onChange={(e) => upd(i, { description: e.target.value })} />
                {products && products.length > 0 && (
                  <Select onValueChange={(id) => { const p = products.find((x) => x.id === id); if (p) upd(i, { description: p.name, unit_price: Number(p.unit_price) }); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Aus Produktkatalog …" /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              <Input type="number" min="0" step="1" value={it.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} />
              <Input type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => upd(i, { unit_price: Number(e.target.value) })} />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setItems([...items, { description: "", quantity: 1, unit_price: 0 }])}>+ Position</Button>
          <Textarea placeholder="Hinweis im Angebot" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex items-center justify-between"><span className="font-semibold">Summe: {eur(total(items))}</span><Button onClick={create}>Angebot speichern</Button></div>
        </div>
      )}
      <div className="space-y-2">
        {offers?.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Noch keine Angebote.</p>}
        {offers?.map((o) => (
          <div key={o.id} className="space-y-1 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{o.offer_number} · {o.customer?.name ?? "Ohne Kunde"}</span>
              <span className="flex items-center gap-2"><Badge variant="secondary">{STATUS[o.status] ?? o.status}</Badge><b>{eur(total(o.items as Item[]))}</b></span>
            </div>
            <ul className="text-sm text-muted-foreground">{(o.items as Item[]).map((i, k) => <li key={k}>{i.quantity} × {i.description} – {eur(Number(i.unit_price))}</li>)}</ul>
            {o.note && <p className="text-sm italic">{o.note}</p>}
            <div className="flex gap-1">{Object.entries(STATUS).filter(([k]) => k !== o.status).map(([k, v]) => <Button key={k} size="sm" variant="ghost" onClick={() => setStatus(o.id, k)}>{v}</Button>)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Customers() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", phone: "", address: "" });
  const { data } = useQuery({ queryKey: ["offer-customers-full"], queryFn: async () => (await supabase.from("offer_customers").select("*").order("name")).data ?? [] });
  async function add() {
    if (!f.name.trim()) return;
    const { error } = await supabase.from("offer_customers").insert({ ...f, created_by: user.id });
    if (error) { toast.error(error.message); return; }
    setF({ name: "", email: "", phone: "", address: "" });
    qc.invalidateQueries({ queryKey: ["offer-customers-full"] }); qc.invalidateQueries({ queryKey: ["offer-customers"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("offer_customers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["offer-customers-full"] }); qc.invalidateQueries({ queryKey: ["offer-customers"] });
  }
  return (
    <div className="space-y-3 pt-3">
      <div className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-2">
        {(["name", "email", "phone", "address"] as const).map((k) => (
          <Input key={k} placeholder={{ name: "Kundenname", email: "E-Mail", phone: "Telefon", address: "Adresse" }[k]} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        ))}
        <Button onClick={add} disabled={!f.name.trim()}>Neuer Kunde</Button>
      </div>
      {data?.length === 0 && <p className="text-sm text-muted-foreground">Keine Kunden.</p>}
      <div className="divide-y rounded-xl border bg-card">
        {data?.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 p-3">
            <span><span className="block font-medium">{c.name}</span><span className="text-sm text-muted-foreground">{[c.email, c.phone, c.address].filter(Boolean).join(" · ")}</span></span>
            <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>Löschen</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Products() {
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", description: "", unit_price: 0 });
  const { data } = useQuery({ queryKey: ["offer-products"], queryFn: async () => (await supabase.from("offer_products").select("*").order("name")).data ?? [] });
  async function add() {
    if (!f.name.trim()) return;
    const { error } = await supabase.from("offer_products").insert(f);
    if (error) { toast.error(error.message); return; }
    setF({ name: "", description: "", unit_price: 0 });
    qc.invalidateQueries({ queryKey: ["offer-products"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("offer_products").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["offer-products"] });
  }
  return (
    <div className="space-y-3 pt-3">
      {admin ? (
        <div className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_1fr_8rem_auto]">
          <Input placeholder="Produktname" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="Beschreibung" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Input type="number" min="0" step="0.01" value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: Number(e.target.value) })} />
          <Button onClick={add} disabled={!f.name.trim()}>Neues Produkt</Button>
        </div>
      ) : <p className="text-sm text-muted-foreground">Der Produktkatalog wird von Admins gepflegt.</p>}
      <div className="divide-y rounded-xl border bg-card">
        {data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">Keine Produkte.</p>}
        {data?.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 p-3">
            <span><span className="block font-medium">{p.name}</span><span className="text-sm text-muted-foreground">{p.description}</span></span>
            <span className="flex items-center gap-2"><b>{eur(Number(p.unit_price))}</b>{admin && <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>Löschen</Button>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
