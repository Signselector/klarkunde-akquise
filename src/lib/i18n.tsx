import { useSyncExternalStore } from "react";
import { translateText } from "./i18n-dict";

export type Lang = "de" | "en";
const KEY = "cc-lang";

let current: Lang = "de";
try {
  if (typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "en") current = "en";
} catch {
  /* storage can be blocked */
}
const listeners = new Set<() => void>();

export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => "de" as Lang,
  );
}

/** Translation for code that builds texts itself. The page as a whole is translated by the DOM layer below. */
export function tr(text: string): string {
  return current === "en" ? translateText(text) : text;
}
export function useT() {
  useLang();
  return tr;
}

/* ------------------------------------------------------------------------------------------------------------
 * Whole-page translation. The app texts are German in the source; with English selected every text node and the
 * attributes placeholder / title / aria-label / alt are replaced by their English version (see i18n-en-*.ts) and
 * restored when switching back. A missing entry simply stays German.
 * ---------------------------------------------------------------------------------------------------------- */
const ATTRS = ["placeholder", "title", "aria-label", "alt", "aria-description"];
const SKIP = "script,style,textarea,noscript,[data-no-i18n]";

const textOrig = new Map<Text, { de: string; en: string }>();
const attrOrig = new Map<Element, Record<string, { de: string; en: string }>>();
let observer: MutationObserver | null = null;

function translateTextNode(n: Text) {
  const v = n.nodeValue ?? "";
  const known = textOrig.get(n);
  if (known && known.en === v) return;
  if (n.parentElement?.closest(SKIP)) return;
  const lead = /^\s*/.exec(v)?.[0] ?? "";
  const trail = /\s*$/.exec(v)?.[0] ?? "";
  const out = translateText(v);
  if (out === v) {
    if (known) textOrig.delete(n);
    return;
  }
  const en = out === v ? v : lead + out.trim() + trail;
  textOrig.set(n, { de: v, en });
  n.nodeValue = en;
}

function translateAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    const rec = attrOrig.get(el)?.[a];
    if (rec && rec.en === v) continue;
    const out = translateText(v);
    if (out === v) {
      if (rec) delete attrOrig.get(el)![a];
      continue;
    }
    const all = attrOrig.get(el) ?? {};
    all[a] = { de: v, en: out };
    attrOrig.set(el, all);
    el.setAttribute(a, out);
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const el = root as Element;
  if (el.nodeType === Node.ELEMENT_NODE) {
    if (el.closest?.(SKIP)) return;
    translateAttrs(el);
    el.querySelectorAll("[placeholder],[title],[aria-label],[alt],[aria-description]").forEach(translateAttrs);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    translateTextNode(n as Text);
    n = walker.nextNode();
  }
}

function restoreAll() {
  textOrig.forEach((rec, node) => {
    if (node.nodeValue === rec.en) node.nodeValue = rec.de;
  });
  textOrig.clear();
  attrOrig.forEach((rec, el) => {
    for (const [a, v] of Object.entries(rec)) if (el.getAttribute(a) === v.en) el.setAttribute(a, v.de);
  });
  attrOrig.clear();
}

function startObserver() {
  if (observer || typeof document === "undefined") return;
  observer = new MutationObserver((records) => {
    // Our own edits come back as records too; they are skipped because the node already holds the English text.
    for (const r of records) {
      if (r.type === "childList") r.addedNodes.forEach((n) => translateTree(n));
      else if (r.type === "characterData") translateTextNode(r.target as Text);
      else if (r.type === "attributes") translateAttrs(r.target as Element);
    }
    // Detached nodes must not pile up.
    if (textOrig.size > 4000) textOrig.forEach((_v, n) => !n.isConnected && textOrig.delete(n));
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

function applyLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current;
  if (current === "en") {
    translateTree(document.documentElement);
    startObserver();
  } else {
    observer?.disconnect();
    observer = null;
    restoreAll();
  }
}

export function setLang(next: Lang) {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  applyLanguage();
  listeners.forEach((l) => l());
}

/** Call once on the client after the first render. */
export function initI18n() {
  applyLanguage();
}

/* Dates and numbers: German formats become British English formats while English is selected. */
if (typeof window !== "undefined") {
  const map = (l: unknown) => (current === "en" && typeof l === "string" && /^de(-|$)/i.test(l) ? "en-GB" : l);
  // Formatters are often created once at module level. They look at the language each time they are used.
  for (const name of ["DateTimeFormat", "NumberFormat", "RelativeTimeFormat"] as const) {
    const Orig = (Intl as unknown as Record<string, new (...a: unknown[]) => object>)[name];
    if (!Orig) continue;
    (Intl as unknown as Record<string, unknown>)[name] = new Proxy(Orig, {
      construct: (_t, args) => {
        const [locale, ...rest] = args;
        let lang = current;
        let inst = new Orig(map(locale), ...rest);
        return new Proxy(Object.create(Orig.prototype) as object, {
          get: (_target, prop) => {
            if (lang !== current) {
              lang = current;
              inst = new Orig(map(locale), ...rest);
            }
            const v = (inst as Record<string | symbol, unknown>)[prop];
            return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(inst) : v;
          },
        });
      },
      apply: (_t, _this, args) => (Orig as unknown as (...a: unknown[]) => unknown)(map(args[0]), ...args.slice(1)),
    });
  }
  for (const [proto, method] of [
    [Date.prototype, "toLocaleString"],
    [Date.prototype, "toLocaleDateString"],
    [Date.prototype, "toLocaleTimeString"],
    [Number.prototype, "toLocaleString"],
  ] as const) {
    const orig = (proto as unknown as Record<string, (...a: unknown[]) => string>)[method]!;
    (proto as unknown as Record<string, unknown>)[method] = function (this: unknown, ...args: unknown[]) {
      return orig.call(this, map(args[0]), ...args.slice(1));
    };
  }
}
