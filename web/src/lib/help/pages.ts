// The names of the app pages an article can link to ("Open this page"), as message keys that already exist.
import { tk, type MessageKey } from "@/lib/i18n";

export const PAGE_NAMES: Record<string, MessageKey> = {
  "/app": tk("shell.navOverview"),
  "/app/cards": tk("shell.navCards"),
  "/app/share": tk("shell.navShare"),
  "/app/contacts": tk("shell.navContacts"),
  "/app/analytics": tk("shell.navAnalytics"),
  "/app/share/signature": tk("shell.navSignature"),
  "/app/contacts/scan": tk("shell.navScan"),
  "/app/team": tk("shell.navTeam"),
  "/app/departments": tk("shell.navDepartments"),
  "/app/brand": tk("shell.navBrand"),
  "/app/fields": tk("shell.navFields"),
  "/app/directory": tk("shell.navDirectory"),
  "/app/activity": tk("shell.navActivity"),
  "/app/billing": tk("shell.navBilling"),
  "/app/settings": tk("shell.navSettings"),
  "/app/settings/sign-in": tk("settings.signInMethods"),
  "/app/settings/privacy": tk("settings.privacyData"),
  "/app/settings/notifications": tk("settings.weeklyReport"),
  "/app/settings/integrations": tk("settings.integrations"),
};

/** Every page an article may point at. A page outside this list is a broken link in the checks. */
export const KNOWN_PAGES: string[] = [...Object.keys(PAGE_NAMES), "/app/help"];

/** Who a guide is for, as shown on its tags and filters. */
export const AUDIENCE_LABEL = {
  personal: tk("help.audPersonal"),
  company_owner: tk("help.audOwner"),
  company_admin: tk("help.audAdmin"),
  employee: tk("help.audEmployee"),
} as const;
