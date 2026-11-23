import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ContactClient } from "@/components/support/ContactClient";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("support.contactTitle") };
}

export default async function ContactPage() {
  const { t } = await getI18n();
  return (
    <AuthShell title={t("support.contactTitle")} lead={t("support.contactLead")} footer={<Link href="/login?next=/app/support">{t("support.contactSignIn")}</Link>}>
      <ContactClient />
    </AuthShell>
  );
}
