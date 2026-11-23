import type { Metadata } from "next";
import { decodeToken } from "@/lib/privacy";
import { AuthShell } from "@/components/auth/AuthShell";
import { RestoreByLink } from "@/components/auth/AccountLinks";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.restoreTitle"), robots: { index: false } };
}

export default async function RestorePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.restoreTitle")} lead={t("auth.restoreLead")}>
      <RestoreByLink token={decodeToken(token)} />
    </AuthShell>
  );
}
