import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { JoinForm } from "@/components/auth/AuthForms";
import { headers } from "next/headers";
import { API_SERVER_URL } from "@/lib/config";
import { visitorHeaders } from "@/lib/server/client-ip";
import { I18nBoundary } from "@/lib/i18n/Boundary";
import { normaliseLocale } from "@/lib/i18n/config";
import { getI18n, getRequestLanguage } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.joinTitle"), robots: { index: false } };
}
export const dynamic = "force-dynamic";

interface Invite {
  workspace_name: string;
  email: string;
  full_name: string;
  language?: string | null;
}

async function loadInvite(token: string): Promise<Invite | null> {
  try {
    // The token goes in the body of a POST so it never appears in an API address or its logs.
    const r = await fetch(`${API_SERVER_URL}/invites/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...visitorHeaders(await headers()) },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as Invite;
  } catch {
    return null;
  }
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await loadInvite(token);
  const visitor = await getRequestLanguage();
  // The invitation's own language applies until the visitor picks one themselves.
  const locale = !visitor.chosen ? normaliseLocale(invite?.language) ?? undefined : undefined;
  const { t } = await getI18n(locale);
  if (!invite) {
    return (
      <AuthShell title={t("auth.joinInvalidTitle")} lead={t("auth.joinInvalidLead")}>
        <div className="notice bad">{t("auth.joinInvalidText")}</div>
        <Link className="btn ghost" href="/login">{t("auth.goToSignIn")}</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t("auth.joinTitle")} lead={t("auth.joinLead", { name: invite.workspace_name })} locale={locale}>
      <I18nBoundary areas={["common", "err", "apiError", "auth", "security"]} locale={locale}>
        <JoinForm token={token} email={invite.email} fullName={invite.full_name} workspaceName={invite.workspace_name} />
      </I18nBoundary>
    </AuthShell>
  );
}
