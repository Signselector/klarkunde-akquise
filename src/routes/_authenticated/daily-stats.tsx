import { createFileRoute, redirect } from "@tanstack/react-router";

/** The daily statistics now live in the statistics cockpit (period "Täglich"). */
export const Route = createFileRoute("/_authenticated/daily-stats")({
  beforeLoad: () => {
    throw redirect({ to: "/stats" });
  },
});
