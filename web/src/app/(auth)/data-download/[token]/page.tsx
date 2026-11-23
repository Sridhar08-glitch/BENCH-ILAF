import type { Metadata } from "next";
import { decodeToken } from "@/lib/privacy";
import { AuthShell } from "@/components/auth/AuthShell";
import { DownloadData } from "@/components/auth/AccountLinks";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.downloadTitle"), robots: { index: false } };
}

export default async function DataDownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.downloadTitle")} lead={t("auth.downloadLead")}>
      <DownloadData token={decodeToken(token)} />
    </AuthShell>
  );
}
