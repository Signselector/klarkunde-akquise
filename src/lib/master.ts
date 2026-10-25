/** The master admin is identified by this account, matching `is_master()` in the database. */
export const MASTER_EMAIL = "office@signselector.com";

export function isMasterEmail(email: string | null | undefined) {
  return email?.toLowerCase() === MASTER_EMAIL;
}
