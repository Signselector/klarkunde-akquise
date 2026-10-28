/**
 * "Ansicht als Mitarbeiter": a manager/admin sees the app as one employee does. Read only.
 * The choice lives in sessionStorage (per tab). While it is active every request to the backend carries the header
 * x-view-as, which the database only honours for permitted viewers, and every write is refused here.
 */
export type ViewAs = { id: string; name: string; email: string | null; role: string };

const KEY = "cc-view-as";

export function getViewAs(): ViewAs | null {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as ViewAs) : null;
    return v && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

export function setViewAs(v: ViewAs | null) {
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Calls that only read: the database functions the personal pages use, plus session housekeeping. */
const READ_RPC = /^(get_|my_|has_role$|is_|user_role$|can_|view_as_target$|heartbeat$|set_offline$|log_activity$)/;

/** Whether a backend request may go out while a view is active. */
export function allowedWhileViewing(method: string, url: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(url);
  if (rpc) return READ_RPC.test(rpc[1]!);
  // Sign-out and token refresh must keep working.
  return /\/auth\/v1\//.test(url);
}

let readDepth = 0;
/** Lets server functions that only read (e.g. "Meine Kunden") through while a view is active. */
export async function withViewAsRead<T>(fn: () => Promise<T>): Promise<T> {
  readDepth++;
  try {
    return await fn();
  } finally {
    readDepth--;
  }
}

let installed = false;
/** Wraps window.fetch once: adds the header and refuses writes while a view is active. */
export function installViewAsGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  const base = String(import.meta.env["VITE_SUPABASE_URL"] ?? "").replace(/\/+$/, "");
  window.fetch = (input, init) => {
    const view = getViewAs();
    if (!view) return original(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const toBackend = !!base && url.startsWith(base + "/");
    const toServerFn = url.includes("/_serverFn/");
    if (!toBackend && !toServerFn) return original(input, init);
    if (toBackend && !allowedWhileViewing(method, url)) return Promise.resolve(blocked());
    if (toServerFn && readDepth === 0) return Promise.resolve(blocked());
    const headers = new Headers(typeof input === "object" && "headers" in input ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    headers.set("x-view-as", view.id);
    return original(input, { ...init, headers });
  };
}

function blocked() {
  return new Response(JSON.stringify({ message: "view_only", code: "42501" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
