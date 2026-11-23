import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { getI18n } from "@/lib/i18n/server";

// Opened from the link in a product-update e-mail: one button, no sign-in. Nothing changes until the button is pressed.
type Props = { searchParams: Promise<{ t?: string; done?: string; error?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("bo.unsubTitle"), robots: { index: false, follow: false } };
}

export default async function UnsubscribePage({ searchParams }: Props) {
  const sp = await searchParams;
  const { t } = await getI18n();
  if (sp.done) return <AuthShell title={t("bo.unsubDone")}><span /></AuthShell>;
  if (sp.error || !sp.t) return <AuthShell title={t("bo.unsubBad")}><span /></AuthShell>;
  return (
    <AuthShell title={t("bo.unsubTitle")} lead={t("bo.unsubText")}>
      <form method="post" action="/unsubscribe/send">
        <input type="hidden" name="token" value={sp.t} />
        <button type="submit" className="btn">{t("bo.unsubButton")}</button>
      </form>
    </AuthShell>
  );
}
