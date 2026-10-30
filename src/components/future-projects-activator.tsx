import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { activateDueFutureProjects } from "@/lib/future-projects.functions";

/** Once per browser session: sends Zukunftsprojekte that became due to Pipedrive, silently in the background. */
export function FutureProjectsActivator() {
  const run = useServerFn(activateDueFutureProjects);
  useEffect(() => {
    const key = `future-projects-checked:${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void run().catch(() => sessionStorage.removeItem(key));
  }, [run]);
  return null;
}
