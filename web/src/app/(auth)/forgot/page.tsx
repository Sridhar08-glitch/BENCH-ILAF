import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotForm } from "@/components/auth/AuthForms";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.forgotTitleMeta") };
}

export default async function ForgotPage() {
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.forgotTitle")} lead={t("auth.forgotLead")}>
      <ForgotForm />
    </AuthShell>
  );
}
