"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { DailySummaryPanel, PushPanel } from "@/components/account/NotifyPanels";
import { Switch } from "@/components/app/Switch";
import { ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import s from "@/components/crm/crm.module.css";
import { crm } from "@/lib/crm/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

export default function NotificationsPage() {
  const { current } = useWs();
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"personal" | "company">("personal");
  const [week, setWeek] = useState<"last" | "current">("last");
  const [show, setShow] = useState(false);
  const prefs = useQuery({ queryKey: ["report-prefs", current.id], queryFn: () => crm.reportPrefs(current.id) });
  const save = useMutation({
    mutationFn: (b: Partial<{ personal_report: boolean; company_report: boolean }>) => crm.updateReportPrefs(current.id, b),
    onSuccess: (d) => {
      qc.setQueryData(["report-prefs", current.id], d);
      toast(t("common.saved"));
    },
    onError: (e) => toast(apiErrorText(e, t, "settings.saveFailed")),
  });
  const preview = useQuery({
    queryKey: ["report-preview", current.id, kind, week],
    queryFn: () => crm.reportPreview(current.id, kind, week),
    enabled: show,
  });
  const p = prefs.data;

  return (
    <div className="view">
      <PageHead title={t("settings.notifTitle")} sub={t("settings.notifSub")}>
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
      </PageHead>

      <div className="panel card">
        <div className="head"><h2><span className="chip"><Icon name="mail" size="s" /></span>{t("settings.weeklyFor", { name: current.name })}</h2></div>
        {prefs.isLoading ? <SkeletonBlocks rows={2} /> : prefs.error ? <ErrorBox error={prefs.error} onRetry={() => void prefs.refetch()} /> : p && (
          <div>
            <div className={s.switchRow}>
              <div><b>{t("settings.myCards")}</b><span className="hint">{t("settings.myCardsHint")}</span></div>
              <Switch label={t("settings.weeklyMineAria")} checked={p.personal_report} disabled={save.isPending} onChange={(on) => save.mutate({ personal_report: on })} />
            </div>
            {p.can_company_report && (
              <div className={s.switchRow}>
                <div><b>{t("settings.wholeCompany")}</b><span className="hint">{t("settings.wholeCompanyHint")}</span></div>
                <Switch label={t("settings.weeklyCompanyAria")} checked={!!p.company_report} disabled={save.isPending} onChange={(on) => save.mutate({ company_report: on })} />
              </div>
            )}
            <p className="hint">{t("settings.unsubscribeNote")}</p>
          </div>
        )}
      </div>

      <DailySummaryPanel />
      <PushPanel />

      <div className="panel card">
        <div className="head">
          <h2><span className="chip accent"><Icon name="eye" size="s" /></span>{t("settings.previewTitle")}</h2>
          {!show && <button type="button" className="btn sm" onClick={() => setShow(true)}>{t("settings.showPreview")}</button>}
        </div>
        <p className="hint">{t("settings.previewNote")}</p>
        {show && (
          <>
            <div className="row">
              {p?.can_company_report && (
                <div className="seg" role="group" aria-label={t("settings.whichReport")}>
                  <button type="button" aria-pressed={kind === "personal"} onClick={() => setKind("personal")}>{t("settings.myCards")}</button>
                  <button type="button" aria-pressed={kind === "company"} onClick={() => setKind("company")}>{t("settings.reportCompany")}</button>
                </div>
              )}
              <div className="seg" role="group" aria-label={t("settings.whichWeek")}>
                <button type="button" aria-pressed={week === "last"} onClick={() => setWeek("last")}>{t("settings.lastWeek")}</button>
                <button type="button" aria-pressed={week === "current"} onClick={() => setWeek("current")}>{t("settings.thisWeek")}</button>
              </div>
            </div>
            {preview.isLoading ? <SkeletonBlocks rows={3} /> : preview.error ? <ErrorBox error={preview.error} onRetry={() => void preview.refetch()} /> : preview.data && (
              <>
                <div className="hint" dir="auto">{t("settings.subject", { subject: preview.data.subject })}</div>
                <iframe className={s.previewFrame} title={t("settings.previewFrame")} sandbox="" srcDoc={preview.data.html} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
