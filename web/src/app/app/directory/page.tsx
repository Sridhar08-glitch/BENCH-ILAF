"use client";

import { EnterpriseGate } from "@/components/app/EnterpriseLock";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Empty, ErrorBox, PageHead, QrPreview, SkeletonBlocks, useToast } from "@/components/app/ui";
import { Switch } from "@/components/app/Switch";
import { useWs } from "@/components/app/WorkspaceContext";
import s from "@/components/ops/ops.module.css";
import { ApiError, api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { keys, useCards, useWorkspaceDetail } from "@/lib/hooks";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { directorySlugProblem, directoryUrl, normaliseDirectorySlug } from "@/lib/ops/directory";
import type { WorkspaceDetail } from "@/lib/types";

function DirectoryPageContent() {
  const { current, isManager, isCompany } = useWs();
  const { t } = useI18n();
  const ws = useWorkspaceDetail(isManager && isCompany ? current.id : "");
  if (!isManager || !isCompany) {
    return (
      <div className="view">
        <PageHead title={t("company.dirTitle")} sub={t("company.dirSubShort")} />
        <div className="panel"><Empty title={t("company.dirManagersOnly")} action={<Link className="btn sm" href="/app/cards">{t("company.goToMyCard")}</Link>} /></div>
      </div>
    );
  }
  if (ws.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (ws.error) return <div className="view"><ErrorBox error={ws.error} onRetry={() => void ws.refetch()} /></div>;
  if (!ws.data) return null;
  return <DirectorySettings key={`${ws.data.id}-${ws.data.brand.directory_slug ?? ""}-${ws.data.brand.directory_enabled}`} ws={ws.data} isOwner={current.role === "owner"} />;
}

function DirectorySettings({ ws, isOwner }: { ws: WorkspaceDetail; isOwner: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const cards = useCards(ws.id);
  const enabled = !!ws.brand.directory_enabled;
  const [on, setOn] = useState(enabled);
  const [slug, setSlug] = useState(ws.brand.directory_slug ?? "");
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const clean = normaliseDirectorySlug(slug);
  const problem = on || slug ? directorySlugProblem(slug, t) : null;
  const dirty = on !== enabled || clean !== (ws.brand.directory_slug ?? "");
  const savedSlug = ws.brand.directory_slug;
  // The directory is the root of the company's own domain once that is verified; before that it is /d/<address> on Bench.
  const link = savedSlug ? (ws.custom_domain ? `https://${ws.custom_domain}/` : directoryUrl(WEB_URL, savedSlug)) : "";

  const live = (cards.data ?? []).filter((c) => c.status === "published");
  const hidden = live.filter((c) => c.hide_from_directory).length;

  const save = useMutation({
    mutationFn: () => api.updateWorkspace(ws.id, { brand: { directory_enabled: on, directory_slug: clean || null } }),
    onSuccess: (w) => {
      qc.setQueryData(keys.workspace(ws.id), w);
      void qc.invalidateQueries({ queryKey: ["audit", ws.id] });
      toast(w.brand.directory_enabled ? t("company.dirOn") : t("company.dirOffSaved"));
      setErr(null);
    },
    onError: setErr,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast(t("company.linkCopied"));
    } catch {
      toast(t("company.copyFailed"));
    }
  }

  const serverMsg = err instanceof ApiError ? apiFieldText(err, "brand.directory_slug", t) ?? apiErrorText(err, t) : null;

  return (
    <div className="view">
      <PageHead title={t("company.dirTitle")} sub={t("company.dirSub")} />

      <section className="panel card" aria-label={t("company.dirSettingsAria")} data-guide="directory-main">
        <div className="head"><h2><span className="chip accent"><Icon name="globe" size="s" /></span>{t("company.publicDirectory")}</h2></div>
        <div className="toggle first" style={{ paddingBlockStart: 0 }}>
          <div>
            {t("company.showPublic")}
            <small>{t("company.showPublicHint")}</small>
          </div>
          <Switch checked={on} onChange={setOn} label={t("company.showPublic")} disabled={!isOwner} />
        </div>
        <label>
          {t("company.dirAddress")}
          <input className="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="your-company" disabled={!isOwner} aria-invalid={tried && !!problem} aria-describedby="dir-hint" />
        </label>
        <div id="dir-hint" className="hint ltr">{directoryUrl(WEB_URL, clean || "your-company")}</div>
        {tried && problem && <span className="err" role="alert">{problem}</span>}
        {serverMsg && <span className="err" role="alert">{serverMsg}</span>}
        {err !== null && !(err instanceof ApiError) && <ErrorBox error={err} />}
        {!isOwner && <div className="notice"><Icon name="lock" /><div className="grow">{t("company.dirOwnerOnly")}</div></div>}
        {isOwner && (
          <div className="row">
            <button type="button" className="btn" disabled={!dirty || save.isPending} onClick={() => { setTried(true); if (on && problem) return; save.mutate(); }}>{save.isPending ? t("common.saving") : t("common.save")}</button>
            <span className="hint">{dirty ? t("company.unsaved") : t("common.saved")}</span>
          </div>
        )}
      </section>

      {enabled && savedSlug && (
        <section className="panel card" aria-label={t("company.dirLinkAria")}>
          <div className="head"><h2><span className="chip"><Icon name="share" size="s" /></span>{t("company.shareDir")}</h2></div>
          <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
            <span className={s.qrBox}><QrPreview text={link} label={t("company.dirQr", { name: ws.name })} /></span>
            <div className="pane" style={{ flex: "1 1 260px" }}>
              <div className={s.dirLink}>
                <code className="ltr">{link}</code>
                <button type="button" className="btn ghost sm" onClick={() => void copy()}><Icon name="copy" size="s" />{t("company.copyLink")}</button>
                <a className="btn sm" href={ws.custom_domain ? link : `/d/${savedSlug}`} target="_blank" rel="noreferrer"><Icon name="arrow" size="s" />{t("common.open")}</a>
              </div>
              <p className="hint">
                {t("company.dirCount", { shown: live.length - hidden, total: live.length })}
                {hidden > 0 ? ` ${t("company.dirHidden", { n: hidden })}` : ""} {t("company.dirNeverListed")}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default function DirectoryPage() {
  const { t } = useI18n();
  return <EnterpriseGate feature="directory" title={t("company.dirTitle")} sub={t("company.dirSubShort")}><DirectoryPageContent /></EnterpriseGate>;
}
