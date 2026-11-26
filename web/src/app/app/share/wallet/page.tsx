"use client";

// The wallet pass section of Share: add the card to the phone's wallet (Google Wallet where the server offers it).
import { Suspense } from "react";
import { ToolCardPage } from "@/components/app/ToolCard";
import { SkeletonBlocks } from "@/components/app/ui";
import { WalletButton } from "@/components/app/WalletButton";
import { useI18n } from "@/lib/i18n/client";

export default function WalletSharePage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<SkeletonBlocks rows={3} />}>
      <ToolCardPage title={t("tools.walletTitle")} sub={t("tools.walletSub")}>
        {(card, _ws, picker) => (
          <>
            {picker}
            <div className="panel card">
              {card.status !== "published" && <p className="hint">{t("tools.walletHint")}</p>}
              <WalletButton cardId={card.id} published={card.status === "published"} />
            </div>
          </>
        )}
      </ToolCardPage>
    </Suspense>
  );
}
