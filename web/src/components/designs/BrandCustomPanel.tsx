"use client";

// The "Custom design" part of the company brand page: the request in progress, or the form to ask for one.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RequestForm } from "./RequestForm";
import { StatusPill } from "./shared";
import { designsApi } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export function BrandCustomPanel({ wsId }: { wsId: string }) {
  const { t } = useI18n();
  const list = useQuery({ queryKey: ["design-requests", wsId], queryFn: () => designsApi.requests(wsId) });
  if (list.isLoading) return null;
  const open = (list.data ?? []).find((r) => !["live", "closed", "withdrawn"].includes(r.status));
  if (open) {
    return (
      <div className="notice">
        <div className="grow">
          <div className="row" style={{ flexWrap: "wrap" }}><b>{t("designs.inProgress")}</b><StatusPill status={open.status} /></div>
          <div style={{ marginBlockStart: 8 }}><Link className="btn sm" href={`/app/requests/${open.id}`}>{t("designs.openRequest")}</Link></div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h4 style={{ margin: "8px 0" }}>{t("designs.newRequest")}</h4>
      <RequestForm wsId={wsId} />
      <p style={{ marginBlockStart: 10 }}><Link href="/app/requests" className="linkbtn">{t("designs.seeAllRequests")}</Link></p>
    </div>
  );
}
