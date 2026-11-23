import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/AuthForms";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.loginTitle") };
}

export default async function LoginPage() {
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.loginTitle")} lead={t("auth.loginLead")}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
