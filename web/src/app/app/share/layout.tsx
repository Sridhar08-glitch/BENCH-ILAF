"use client";

// The Share hub: QR code, NFC, e-mail signature, wallet pass and event mode as sections of one page group.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";
import { EmbeddedPage, PageHead } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { useFlags } from "@/lib/flags";
import { useI18n } from "@/lib/i18n/client";
import { activeShareTab, shareTabs } from "@/lib/share/tabs";

function Tabs() {
  const { current } = useWs();
  const { t } = useI18n();
  const flags = useFlags(current.id);
  const pathname = usePathname();
  const card = useSearchParams().get("card");
  const active = activeShareTab(pathname);
  return (
    <nav className="tabs" aria-label={t("tools.shareSections")} data-guide="share-tabs">
      {shareTabs({ wallet: !!flags.wallet_google }).map((tab) => (
        <Link
          key={tab.id}
          href={card && tab.id !== "event" ? `${tab.href}?card=${encodeURIComponent(card)}` : tab.href}
          className="tab"
          aria-current={active === tab.id ? "page" : undefined}
          aria-selected={active === tab.id}
          style={{ textDecoration: "none" }}
        >
          <Icon name={tab.icon} size="s" />
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="view">
      <PageHead title={t("tools.shareTitle")} sub={t("tools.shareSub")} />
      <Suspense fallback={<div className="tabs" aria-hidden="true" style={{ minHeight: 44 }} />}>
        <Tabs />
      </Suspense>
      <EmbeddedPage.Provider value>{children}</EmbeddedPage.Provider>
    </div>
  );
}
