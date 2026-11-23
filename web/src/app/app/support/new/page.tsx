"use client";

// A new request. "Report a problem" opens it with the page the person came from and a hint to attach a screenshot.
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { PageHead } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { TicketForm, type Prefill, type Sent } from "@/components/support/TicketForm";
import { useI18n } from "@/lib/i18n/client";
import { pathOnly } from "@/lib/support/context";

function NewRequest() {
  const { t } = useI18n();
  const { current } = useWs();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [sent, setSent] = useState<Sent | null>(null);
  const from = pathOnly(params.get("from"));
  const report = params.get("report") === "1";
  const prefill: Prefill = { report, from: from || undefined, subject: report && from ? t("support.reportSubject", { page: from }) : undefined, category: report ? "bug" : undefined };

  if (sent && sent.kind === "member") {
    return (
      <div className="view">
        <PageHead title={t("support.sentTitle")} sub={t("support.sentText", { number: sent.ticket.label })} />
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Link className="btn" href={`/app/support/${sent.ticket.id}`}>{t("support.viewRequest")}</Link>
          <Link className="btn ghost" href="/app/support">{t("support.backToList")}</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="view">
      <PageHead title={report ? t("support.reportProblem") : t("support.formTitle")} sub={t("support.sub")}>
        <Link className="btn ghost sm" href="/app/support">{t("support.backToList")}</Link>
      </PageHead>
      <TicketForm
        visitor={false}
        prefill={prefill}
        workspaceId={current.id}
        onSent={(r) => { void qc.invalidateQueries({ queryKey: ["support-tickets"] }); setSent(r); }}
      />
    </div>
  );
}

export default function NewRequestPage() {
  return <Suspense><NewRequest /></Suspense>;
}
