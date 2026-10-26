import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** recruit and veteran are callers, manager has admin rights in the own country, admin can do everything. */
export type RoleName = "recruit" | "veteran" | "manager" | "admin";
export const ROLE_LABEL: Record<RoleName, string> = {
  recruit: "Recruit",
  veteran: "Veteran",
  manager: "Manager",
  admin: "Admin",
};

/** Picks the one primary role out of the stored role rows (the legacy "caller" counts as recruit). */
export function primaryRole(roles: string[]): RoleName {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("manager")) return "manager";
  if (roles.includes("veteran")) return "veteran";
  return "recruit";
}

export function useRoles(userId: string) {
  const { data } = useQuery({
    queryKey: ["roles", userId],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      return (data ?? []).map((r) => r.role as string);
    },
  });
  const role = primaryRole(data ?? []);
  return {
    ready: data !== undefined,
    role,
    fulfilment: !!data?.includes("fulfilment"),
    /** Admin or manager: may administer (managers only in their own country, enforced by the database). */
    isStaff: role === "admin" || role === "manager",
    /** Real admin: backend, integrations and every country. */
    isGlobalAdmin: role === "admin",
    isManager: role === "manager",
    /** Recruits cannot book appointments. */
    canBookAppointments: role !== "recruit",
  };
}

/** True for admins and managers. Backend-only places use `useIsGlobalAdmin`. */
export function useIsAdmin(userId: string) {
  return useRoles(userId).isStaff;
}
export function useIsGlobalAdmin(userId: string) {
  return useRoles(userId).isGlobalAdmin;
}
