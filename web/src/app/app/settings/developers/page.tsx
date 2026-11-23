"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Empty, ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import s from "@/components/crm/crm.module.css";
import { Dialog, Weave, slot } from "@/components/ops/shared";
import { ApiError } from "@/lib/api";
import { integrations, errorText, type ApiKey } from "@/lib/integrations/api";
import { useFlags } from "@/lib/flags";
import { tk, type MessageKey } from "@/lib/i18n";
import { apiFirstFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { copyText } from "@/lib/tools/clipboard";

const SCOPE_TEXT: Record<string, MessageKey> = {
  "cards:read": tk("dev.scCardsRead"),
  "cards:write": tk("dev.scCardsWrite"),
  "leads:read": tk("dev.scLeadsRead"),
  "leads:write": tk("dev.scLeadsWrite"),
  "team:read": tk("dev.scTeamRead"),
  "team:write": tk("dev.scTeamWrite"),
  "analytics:read": tk("dev.scAnalyticsRead"),
};
const STATUS_TEXT: Record<ApiKey["status"], MessageKey> = {
  active: tk("dev.statusActive"), revoked: tk("dev.statusRevoked"), expired: tk("dev.statusExpired"),
};

export default function DevelopersPage() {
  const { current, isManager, isCompany } = useWs();
  const { t, date } = useI18n();
  const flags = useFlags(current.id);
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [rotating, setRotating] = useState<ApiKey | null>(null);
  const list = useQuery({ queryKey: ["api-keys", current.id], queryFn: () => integrations.keys(current.id), enabled: isManager && isCompany });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["api-keys", current.id] });
  const when = (iso: string | null) => (iso ? date(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

  const revoke = useMutation({
    mutationFn: (k: ApiKey) => integrations.revokeKey(current.id, k.id),
    onSuccess: () => { setRevoking(null); refresh(); toast(t("dev.revoked")); },
    onError: (e) => toast(errorText(e, t)),
  });

  if (!isCompany || !isManager) {
    return (
      <div className="view">
        <PageHead title={t("dev.title")} sub={t("dev.sub")} />
        <div className="panel card"><Empty title={isCompany ? t("settings.intOnlyManagers") : t("settings.intCompanyOnly")}>
          {isCompany ? t("settings.intAskOwner") : t("settings.intSwitch")}
        </Empty></div>
      </div>
    );
  }

  return (
    <div className="view">
      <PageHead title={t("dev.title")} sub={t("dev.sub")}>
        <Link className="btn ghost sm" href="/developers">{t("dev.guide")}</Link>
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
        {flags.api_keys && <button type="button" className="btn" onClick={() => setCreating(true)}><Icon name="plus" size="s" />{t("dev.newKey")}</button>}
      </PageHead>
      <div className="panel card">
        <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("dev.keys")}</h2></div>
        <p className="hint">{t("dev.keysHint")}</p>
        {list.isLoading ? <SkeletonBlocks rows={2} /> : list.error ? (
          list.error instanceof ApiError && list.error.code === "subscription_required"
            ? <div className="notice warn" role="alert"><Icon name="crown" /><div className="grow">{t("dev.needsPlan")}</div></div>
            : <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
        ) : (list.data?.results.length ?? 0) === 0 ? (
          <Empty title={t("dev.noKeys")}>{t("dev.noKeysText")}</Empty>
        ) : (
          list.data?.results.map((k) => (
            <div className={s.hook} key={k.id}>
              <div className={s.hookHead}>
                <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                  <div className={s.hookUrl}><bdi>{k.name}</bdi> · <span className="ltr">{k.prefix}…</span></div>
                  <div className="hint">{k.last_used_at ? t("dev.lastUsed", { when: when(k.last_used_at) }) : t("dev.neverUsed")} · {t("dev.usage", { total: k.use_count, today: k.requests_today })}</div>
                  <div className="hint">{k.expires_at ? t("dev.expires", { when: when(k.expires_at) }) : t("dev.noExpiry")} · {k.allowed_ips.length ? t("dev.onlyFrom", { ips: k.allowed_ips.join(", ") }) : t("dev.anyIp")}</div>
                  <div className="hint">{t("dev.limits", { perMin: k.rate_limit.per_minute, perDay: k.rate_limit.per_day })}{k.created_by ? ` · ${t("dev.madeBy", { name: k.created_by, when: when(k.created_at) })}` : ""}</div>
                </div>
                <span className={`pill ${k.status === "active" ? "ok" : "bad"}`}>{t(STATUS_TEXT[k.status])}</span>
              </div>
              <div className="chips">{k.scopes.map((sc) => <span key={sc} className={s.pill2}>{SCOPE_TEXT[sc] ? t(SCOPE_TEXT[sc]) : sc}</span>)}</div>
              {k.status === "active" && (
                <div className="row">
                  <button type="button" className="btn ghost sm" onClick={() => setRotating(k)}>{t("dev.rotate")}</button>
                  <button type="button" className="btn danger sm" onClick={() => setRevoking(k)}>{t("dev.revoke")}</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {creating && <CreateDialog ws={current.id} onClose={() => setCreating(false)} onMade={(secret) => { setCreating(false); setReveal(secret); refresh(); }} />}
      {rotating && <RotateDialog ws={current.id} k={rotating} onClose={() => setRotating(null)} onMade={(secret) => { setRotating(null); setReveal(secret); refresh(); }} />}
      {reveal && <RevealDialog secret={reveal} onClose={() => setReveal(null)} />}
      {revoking && (
        <Dialog title={t("dev.revokeTitle")} onClose={() => setRevoking(null)} footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setRevoking(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} disabled={revoke.isPending} onClick={() => revoke.mutate(revoking)}>{t("dev.revoke")}</button>
          </>
        }>
          <p><Weave text={t("dev.revokeText", { name: slot(0) })} nodes={[<b key="n">{revoking.name}</b>]} /></p>
        </Dialog>
      )}
    </div>
  );
}

function CreateDialog({ ws, onClose, onMade }: { ws: string; onClose: () => void; onMade: (secret: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("");
  const [ips, setIps] = useState("");
  const [err, setErr] = useState("");
  const make = useMutation({
    mutationFn: () => integrations.createKey(ws, {
      name: name.trim(), scopes,
      expires_at: expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null,
      allowed_ips: ips.split(/[\s,]+/).filter(Boolean),
    }),
    onSuccess: (k) => onMade(k.secret ?? ""),
    onError: (e) => setErr(e instanceof ApiError && e.code === "validation_error" ? apiFirstFieldText(e, t) : errorText(e, t)),
  });
  const problem = !name.trim() ? t("dev.errName") : scopes.length === 0 ? t("dev.errScopes") : "";
  return (
    <Dialog title={t("dev.createTitle")} onClose={onClose} footer={
      <>
        <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn" disabled={make.isPending || !!problem} onClick={() => { setErr(""); make.mutate(); }}>{t("dev.create")}</button>
      </>
    }>
      <label>{t("dev.fieldName")}<input dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("dev.namePh")} /></label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 12, color: "var(--mute)" }}>{t("dev.fieldScopes")}</b>
        {Object.entries(SCOPE_TEXT).map(([sc, key]) => (
          <label className="chkrow" key={sc}>
            <input type="checkbox" className="chk" checked={scopes.includes(sc)} onChange={(x) => setScopes((c) => (x.target.checked ? [...c, sc] : c.filter((v) => v !== sc)))} />
            <span><b className="ltr" style={{ color: "var(--ink)" }}>{sc}</b> <span style={{ fontWeight: 400 }}>{t(key)}</span></span>
          </label>
        ))}
      </div>
      <label>{t("dev.fieldExpiry")}<input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
      <label>{t("dev.fieldIps")}<textarea className="ltr" rows={2} value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.0/24" /><span className="hint">{t("dev.ipsHint")}</span></label>
      {err && <span className="err" role="alert">{err}</span>}
    </Dialog>
  );
}

function RotateDialog({ ws, k, onClose, onMade }: { ws: string; k: ApiKey; onClose: () => void; onMade: (secret: string) => void }) {
  const { t } = useI18n();
  const [grace, setGrace] = useState(24);
  const [err, setErr] = useState("");
  const rotate = useMutation({
    mutationFn: () => integrations.rotateKey(ws, k.id, grace),
    onSuccess: (r) => onMade(r.new.secret ?? ""),
    onError: (e) => setErr(errorText(e, t)),
  });
  const options: [number, MessageKey][] = [[0, tk("dev.graceNow")], [1, tk("dev.grace1")], [24, tk("dev.grace24")], [168, tk("dev.grace168")]];
  return (
    <Dialog title={t("dev.rotateTitle")} onClose={onClose} footer={
      <>
        <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn" disabled={rotate.isPending} onClick={() => { setErr(""); rotate.mutate(); }}>{t("dev.rotateButton")}</button>
      </>
    }>
      <p>{t("dev.rotateText")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map(([hours, key]) => (
          <label className="chkrow" key={hours}><input type="radio" name="grace" checked={grace === hours} onChange={() => setGrace(hours)} /><span>{t(key)}</span></label>
        ))}
      </div>
      {err && <span className="err" role="alert">{err}</span>}
    </Dialog>
  );
}

function RevealDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Dialog title={t("dev.revealTitle")} onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>{t("dev.revealDone")}</button>}>
      <div className="notice warn"><Icon name="alert" /><div className="grow"><b>{t("dev.revealWarn")}</b> {t("dev.revealWarnText")}</div></div>
      <div className={s.secret}>
        <code className="ltr">{secret}</code>
        <button type="button" className="btn sm" onClick={async () => toast((await copyText(secret)) ? t("settings.secretCopied") : t("settings.secretCopyFailed"))}>{t("common.copy")}</button>
      </div>
      <p className="hint"><Weave text={t("dev.revealUse", { header: slot(0) })} nodes={[<span key="h" className="ltr">Authorization: Bearer …</span>]} /></p>
    </Dialog>
  );
}
