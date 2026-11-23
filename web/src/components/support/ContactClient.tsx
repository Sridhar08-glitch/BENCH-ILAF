"use client";

// The public contact page: the request form for visitors, then a thank-you with the request number, and the chat button.
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { ChatLauncher } from "./ChatLauncher";
import { TicketForm, type Sent } from "./TicketForm";

export function ContactClient() {
  const { t } = useI18n();
  const [sent, setSent] = useState<Sent | null>(null);
  return (
    <>
      {sent && sent.kind === "visitor" ? (
        <div className="pane" role="status" style={{ gap: 12 }}>
          <h2>{t("support.sentTitle")}</h2>
          <p>{t("support.sentTextVisitor", { number: sent.label, email: sent.email })}</p>
          <div><button type="button" className="btn ghost" onClick={() => setSent(null)}>{t("support.sendAnother")}</button></div>
        </div>
      ) : (
        <TicketForm visitor onSent={setSent} />
      )}
      <ChatLauncher />
    </>
  );
}
