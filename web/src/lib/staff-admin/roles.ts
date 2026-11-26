// Who may do what in the staff area, as the screens need it (hide or disable what a role cannot do).
// The server enforces the same table (backend/staff/perms_map.py); roles.test.ts compares the two so they cannot drift,
// and the permissions page itself is read from the server.
export type StaffRole = "read_only" | "support" | "admin";

export const PERMISSIONS = {
  view: ["admin", "support", "read_only"],
  search: ["admin", "support", "read_only"],
  support: ["admin", "support"],
  suspendCard: ["admin", "support"],
  triage: ["admin", "support"],
  data: ["admin", "support"],
  notes: ["admin", "support"],
  resend: ["admin", "support"],
  export: ["admin", "support"],
  suspendCo: ["admin"],
  announce: ["admin"],
  flags: ["admin"],
  plans: ["admin"],
  staff: ["admin"],
  signOutUser: ["admin"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: StaffRole | undefined | null, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly string[]).includes(role);
}

/** The reason shown on a disabled button, in plain words. */
export function whyNot(role: StaffRole | undefined | null, permission: Permission): string {
  if (can(role, permission)) return "";
  return PERMISSIONS[permission].length === 1 ? "Only an admin can do this." : "Your role cannot do this.";
}

export const ROLE_NAMES: Record<StaffRole, string> = { admin: "Admin", support: "Support", read_only: "Read only" };

/** Menu entries of the dashboard. `perm` hides an entry from roles that cannot use the screen at all. */
export interface AdminNavItem { href: string; label: string; icon: string; group: string; perm?: Permission }

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/staff", label: "Overview", icon: "home", group: "Overview" },
  { href: "/staff/companies", label: "Companies", icon: "users", group: "Customers" },
  { href: "/staff/people", label: "People and cards", icon: "card", group: "Customers" },
  { href: "/staff/enterprise", label: "Enterprise requests", icon: "crown", group: "Customers" },
  { href: "/staff/support-view", label: "Support view", icon: "eye", group: "Customers", perm: "support" },
  { href: "/staff/abuse", label: "Abuse and safety", icon: "alert", group: "Trust and safety" },
  { href: "/staff/data-requests", label: "Data requests", icon: "download", group: "Trust and safety" },
  { href: "/staff/applications", label: "Applications", icon: "mail", group: "Growth" },
  { href: "/staff/announcements", label: "Announcements", icon: "bell", group: "Growth" },
  { href: "/staff/analytics", label: "Business analytics", icon: "chart", group: "Growth" },
  { href: "/staff/system", label: "System health", icon: "settings", group: "Platform" },
  { href: "/staff/flags", label: "Feature switches", icon: "check", group: "Platform" },
  { href: "/staff/billing", label: "Billing", icon: "crown", group: "Platform" },
  { href: "/staff/team", label: "Staff and permissions", icon: "user", group: "Staff" },
  { href: "/staff/audit", label: "Audit log", icon: "clock", group: "Staff" },
];

/** The entries a role sees. */
export function navFor(role: StaffRole | undefined | null): AdminNavItem[] {
  return ADMIN_NAV.filter((n) => !n.perm || can(role, n.perm));
}
