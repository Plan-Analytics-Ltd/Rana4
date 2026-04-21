/**
 * Private dev panel (`/dev` in the app + `/dev/*` API): only these sign-ins may access.
 * Hardcoded allowlist (per product requirement).
 */
export function getDevPanelAllowedEmails(): string[] {
  const DEV_EMAILS = ["aelsaman@plananalytics.co.uk"] as const;
  return DEV_EMAILS.map((e) => e.trim().toLowerCase());
}

export function isDevPanelEmail(email: string): boolean {
  const list = getDevPanelAllowedEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
