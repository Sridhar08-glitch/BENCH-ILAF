"use client";

// Company settings that build trust: the 2-step verification rule, the verified e-mail domain badge and the look of
// the company's e-mails (reply-to address and a preview of the invite e-mail).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/app/Switch";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { privacyApi } from "@/lib/account-api";
import { keys, useWorkspaceDetail } from "@/lib/hooks";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { companyTrustApi, type VerifiedDomainRow } from "@/lib/security-api";
import { cleanDomainInput, cleanReplyTo, mailboxChoices } from "@/lib/company-trust";

/** The owner's switch: everyone in the company must use 2-step verification (7 days to turn it on). */
export function Require2faPanel() {
  const { current, role } = useWs();
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useWorkspaceDetail(current.id);
  const on = !!detail.data?.security?.require_2fa;
  const grace = detail.data?.security?.two_factor_grace_days ?? 7;
  const save = useMutation({
    mutationFn: (next: boolean) => privacyApi.saveSecurity(current.id, { require_2fa: next }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(current.id) });
      toast(t("common.saved"));
    },
    onError: (e) => toast(apiErrorText(e, t, "settings.saveFailed")),
  });
  if (role !== "owner" || current.kind !== "company") return null;
  return (
    <section className="panel card" aria-labelledby="req2fa-h">
      <div className="head"><h2 id="req2fa-h"><span className="chip"><Icon name="lock" size="s" /></span>{t("security.requireTitle")}</h2></div>
      <div className="hint">{t("security.requireHint", { days: grace })}</div>
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        <b className="grow">{t("security.requireLabel")}</b>
        <Switch label={t("security.requireLabel")} checked={on} disabled={save.isPending || detail.isLoading} onChange={(v) => save.mutate(v)} />
      </div>
    </section>
  );
}

function DomainRow({ row, ws, owner, onChanged }: { row: VerifiedDomainRow; ws: string; owner: boolean; onChanged: () => void }) {
  const { t, date } = useI18n();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="prow on">
      <div className="prow-h">
        <span className="chip"><Icon name={row.status === "verified" ? "check" : "mail"} size="s" /></span>
        <span className="grow">
          <b className="ltr" dir="ltr">{row.domain}</b>
          <span className="hint" style={{ display: "block" }}>
            {row.status === "verified" ? t("security.domainVerified", { date: row.verified_at ? date(row.verified_at) : "" })
              : row.status === "expired" ? t("security.domainExpired")
              : t("security.domainPending", { to: row.sent_to ?? "" })}
          </span>
        </span>
        {owner && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await companyTrustApi.removeDomain(ws, row.id);
              toast(t("security.domainRemoved"));
              onChanged();
            } catch (e) {
              setErr(apiErrorText(e, t, "settings.saveFailed"));
            } finally {
              setBusy(false);
            }
          }}>{t("common.remove")}</button>
        )}
      </div>
      {owner && row.status === "pending" && (
        <form className="copybox" onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          setBusy(true);
          try {
            await companyTrustApi.verifyDomain(ws, row.id, code.replace(/\s/g, ""));
            toast(t("security.domainNowVerified"));
            onChanged();
          } catch (e2) {
            setErr(apiErrorText(e2, t, "settings.saveFailed"));
          } finally {
            setBusy(false);
          }
        }}>
          <input className="ltr" dir="ltr" inputMode="numeric" maxLength={9} autoComplete="one-time-code" value={code} placeholder={t("security.domainCodePh")} aria-label={t("security.domainCode")} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="btn sm" disabled={busy || code.replace(/\s/g, "").length !== 6}>{t("security.domainConfirm")}</button>
        </form>
      )}
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}

/** Prove an e-mail domain: the company gets a "Verified company" badge on its cards and in the directory. */
export function VerifiedDomainsPanel() {
  const { current, role } = useWs();
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const owner = role === "owner";
  const [domain, setDomain] = useState("");
  const [mailbox, setMailbox] = useState("admin");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const detail = useWorkspaceDetail(current.id);
  const list = useQuery({ queryKey: ["domains", current.id], queryFn: () => companyTrustApi.domains(current.id), enabled: current.kind === "company" });
  if (current.kind !== "company") return null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["domains", current.id] });
    void qc.invalidateQueries({ queryKey: keys.workspace(current.id) });
  };
  const clean = cleanDomainInput(domain);
  const suggested = detail.data?.security?.suggested_email_domains ?? [];
  return (
    <section className="panel card" aria-labelledby="dom-h">
      <div className="head"><h2 id="dom-h"><span className="chip"><Icon name="check" size="s" /></span>{t("security.domainsTitle")}</h2></div>
      <div className="hint">{t("security.domainsHint")}</div>
      {list.isLoading ? <SkeletonBlocks rows={2} /> : list.error ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} /> : (
        <>
          {list.data?.domains.map((d) => <DomainRow key={d.id} row={d} ws={current.id} owner={owner} onChanged={refresh} />)}
          {suggested.length > 0 && <div className="hint" role="note">{t("security.domainSuggest", { domains: suggested.join(", ") })}</div>}
          {owner && (
            <form className="pane" style={{ gap: 8 }} onSubmit={async (e) => {
              e.preventDefault();
              setErr("");
              setBusy(true);
              try {
                const r = await companyTrustApi.claimDomain(current.id, clean, mailbox.trim().toLowerCase() === "admin" ? undefined : mailbox.trim());
                setDomain("");
                toast(r.status === "verified" ? t("security.domainNowVerified") : t("security.domainSent", { to: r.sent_to ?? "" }));
                refresh();
              } catch (e2) {
                setErr(apiErrorText(e2, t, "settings.saveFailed"));
              } finally {
                setBusy(false);
              }
            }}>
              <label>{t("security.domainField")}
                <input className="ltr" dir="ltr" value={domain} placeholder="northgate.com" autoComplete="off" onChange={(e) => setDomain(e.target.value)} />
              </label>
              <label>{t("security.domainMailbox")}
                <input className="ltr" dir="ltr" list="domain-mailboxes" value={mailbox} placeholder={t("security.domainMailboxPh", { domain: clean || "northgate.com" })} autoComplete="off" onChange={(e) => setMailbox(e.target.value)} />
                <datalist id="domain-mailboxes">
                  {mailboxChoices(clean).map((m) => <option key={m} value={m} />)}
                </datalist>
              </label>
              {err && <span className="err" role="alert">{err}</span>}
              <button type="submit" className="btn" disabled={busy || !clean}>{t("security.domainSend")}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

/** The reply-to address of the company's e-mails and a preview of the invite e-mail as its people will see it. */
export function EmailBrandingPanel() {
  const { current, role } = useWs();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const owner = role === "owner";
  const [lang, setLang] = useState<"en" | "ar">(locale === "ar" ? "ar" : "en");
  const [value, setValue] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const reply = useQuery({ queryKey: ["reply-to", current.id], queryFn: () => companyTrustApi.replyTo(current.id), enabled: current.kind === "company" });
  const preview = useQuery({ queryKey: ["email-preview", current.id, lang, reply.data?.reply_to_email ?? ""], queryFn: () => companyTrustApi.emailPreview(current.id, lang), enabled: current.kind === "company" });
  const save = useMutation({
    mutationFn: (v: string) => companyTrustApi.saveReplyTo(current.id, v),
    onSuccess: (d) => {
      qc.setQueryData(["reply-to", current.id], d);
      setValue(null);
      setErr("");
      toast(t("common.saved"));
    },
    onError: (e) => setErr(apiErrorText(e, t, "settings.saveFailed")),
  });
  if (current.kind !== "company") return null;
  const shown = value ?? reply.data?.reply_to_email ?? "";
  return (
    <section className="panel card" aria-labelledby="mail-h" style={{ gridColumn: "1 / -1" }}>
      <div className="head"><h2 id="mail-h"><span className="chip"><Icon name="mail" size="s" /></span>{t("security.mailTitle")}</h2></div>
      <div className="hint">{t("security.mailHint")}</div>
      {owner && (
        <form className="copybox" onSubmit={(e) => { e.preventDefault(); save.mutate(cleanReplyTo(shown)); }}>
          <input className="ltr" dir="ltr" type="email" inputMode="email" value={shown} placeholder="people@northgate.com" aria-label={t("security.replyTo")} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="btn sm" disabled={save.isPending || value === null}>{t("common.save")}</button>
        </form>
      )}
      {err && <span className="err" role="alert">{err}</span>}
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b>{t("security.previewTitle")}</b>
        <div role="group" aria-label={t("security.previewLang")} className="row" style={{ gap: 6 }}>
          <button type="button" className={`btn sm ${lang === "en" ? "" : "ghost"}`} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          <button type="button" className={`btn sm ${lang === "ar" ? "" : "ghost"}`} aria-pressed={lang === "ar"} onClick={() => setLang("ar")}>العربية</button>
        </div>
      </div>
      {preview.isLoading ? <SkeletonBlocks rows={3} /> : preview.error ? <ErrorBox error={preview.error} onRetry={() => void preview.refetch()} /> : preview.data && (
        <>
          <div className="hint" dir="ltr" style={{ textAlign: "start" }}>
            <div>{t("security.previewFrom")}: <b>{preview.data.from}</b></div>
            <div>{t("security.previewSubject")}: <b>{preview.data.subject}</b></div>
            {preview.data.reply_to && <div>{t("security.previewReplyTo")}: <b>{preview.data.reply_to}</b></div>}
          </div>
          {!preview.data.has_logo && <div className="hint">{t("security.previewNoLogo")}</div>}
          {/* The mail is drawn by the server from the company's own text; the frame has no script and no access to this page. */}
          <iframe
            title={t("security.previewFrame")}
            sandbox=""
            srcDoc={preview.data.html}
            style={{ width: "100%", minHeight: 520, border: "1px solid var(--border, #e8e9ed)", borderRadius: 12, background: "#fff" }}
          />
        </>
      )}
    </section>
  );
}
