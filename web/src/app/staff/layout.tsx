import type { Metadata } from "next";
import { StaffShell } from "@/components/staff/StaffShell";
import { I18nBoundary } from "@/lib/i18n/Boundary";

// Not linked from the customer app and never indexed.
export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false } };

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nBoundary areas={["common", "err", "apiError", "card", "editor", "dash", "designs", "staff", "bo"]}>
      <StaffShell>{children}</StaffShell>
    </I18nBoundary>
  );
}
