/** Local company app roles — permissions (`usePermissions`) me yahi use hote hain. */
export const COMPANY_SHARE_ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "data-entry", label: "Data Entry" },
  { value: "accountant", label: "Accountant" },
  { value: "editor", label: "Editor" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
] as const;

/** Manage Sharing → Role Permissions editor (owner included). */
export const COMPANY_PERMISSION_ROLE_OPTIONS = [
  ...COMPANY_SHARE_ROLE_OPTIONS,
  { value: "owner", label: "Owner" },
] as const;

export const LOCAL_COMPANY_APP_ROLES = COMPANY_SHARE_ROLE_OPTIONS;

export type LocalCompanyAppRole = (typeof LOCAL_COMPANY_APP_ROLES)[number]["value"];

const VALID = new Set<string>(LOCAL_COMPANY_APP_ROLES.map((r) => r.value));

export function normalizeLocalCompanyAppRole(raw: unknown): LocalCompanyAppRole {
  const r = String(raw ?? "manager")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  if (VALID.has(r)) return r as LocalCompanyAppRole;
  return "viewer";
}

export function localCompanyAppRoleLabel(role: string): string {
  const n = normalizeLocalCompanyAppRole(role);
  return LOCAL_COMPANY_APP_ROLES.find((r) => r.value === n)?.label ?? n;
}

/** Shared user / permission role display — table + Role Permissions dropdown same labels. */
export function companyShareRoleLabel(role: unknown): string {
  const r = String(role ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  if (r === "owner") return "Owner";
  return localCompanyAppRoleLabel(r);
}
