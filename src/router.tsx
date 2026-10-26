import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  // After a new deploy/update, open tabs may request old file versions that no longer exist.
  // Reload once so the tab picks up the current version instead of showing a blank screen.
  if (typeof window !== "undefined" && !(window as { __ccChunkGuard?: boolean }).__ccChunkGuard) {
    (window as { __ccChunkGuard?: boolean }).__ccChunkGuard = true;
    const KEY = "cc-chunk-reload";
    const isChunkError = (msg: string) =>
      /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
        msg,
      );
    const recover = (msg: string) => {
      if (!isChunkError(msg)) return;
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < 10_000) return; // avoid reload loops
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", (e) => {
      e.preventDefault();
      recover("Failed to fetch dynamically imported module");
    });
    window.addEventListener("error", (e) => recover(String(e.message ?? "")));
    window.addEventListener("unhandledrejection", (e) =>
      recover(String((e.reason as Error)?.message ?? e.reason ?? "")),
    );
  }

  return router;
};
