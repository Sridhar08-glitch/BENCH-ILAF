"use client";

import { Suspense, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { ToolCardPage, companyLogo, toolColours } from "@/components/app/ToolCard";
import { SkeletonBlocks, useToast } from "@/components/app/ui";
import { Switch } from "@/components/app/Switch";
import { API_PUBLIC_URL } from "@/lib/config";
import { itemLabel } from "@/lib/card/catalogue";
import { hrefFor } from "@/lib/card/href";
import { useI18n } from "@/lib/i18n/client";
import { copyRich, copyText } from "@/lib/tools/clipboard";
import { announceFlag } from "@/lib/guide/api";
import {
  DEFAULT_COLOURS, PROBLEM_KEYS, TEMPLATES, buildSignatureHtml, buildSignatureText, emailHtmlProblems, signatureLabels, wrapForSource,
  type PaletteChoice, type SignatureData, type SignatureOptions, type SignatureTemplate,
} from "@/lib/tools/signature";
import type { Card, WorkspaceDetail } from "@/lib/types";

export default function SignaturePage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<div className="view"><SkeletonBlocks rows={3} /></div>}>
      <ToolCardPage title={t("tools.sigTitle")} sub={t("tools.sigSub")}>
        {(card, ws, picker) => (
          <>
            {picker}
            <SignatureMaker key={card.id} card={card} ws={ws} />
          </>
        )}
      </ToolCardPage>
    </Suspense>
  );
}

const first = (card: Card, kinds: string[]) => {
  for (const k of kinds) {
    const it = card.items.find((i) => i.kind === k && i.on && i.value.trim());
    if (it) return it.value.trim();
  }
  return "";
};

/** Link buttons a signature can carry, taken from the card: booking and profile links. */
function linkChoices(card: Card): { id: string; label: string; href: string }[] {
  const out: { id: string; label: string; href: string }[] = [];
  card.items.forEach((it, i) => {
    if (!it.on || !it.value.trim() || !["Meeting", "Calendly", "LinkedIn", "Instagram", "WhatsApp", "Custom"].includes(it.kind)) return;
    const href = hrefFor(it.kind, it.value);
    if (!href || !/^https?:/i.test(href)) return;
    out.push({ id: `${i}`, label: itemLabel(it).slice(0, 24), href });
  });
  return out.slice(0, 8);
}

function SignatureMaker({ card, ws }: { card: Card; ws: WorkspaceDetail | undefined }) {
  const toast = useToast();
  const { t, locale, list } = useI18n();
  const [template, setTemplate] = useState<SignatureTemplate>(ws?.kind === "company" ? "banner" : "classic");
  const [showPhoto, setShowPhoto] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [showButtons, setShowButtons] = useState(true);
  const [paletteChoice, setPaletteChoice] = useState<PaletteChoice>("card");
  const choices = useMemo(() => linkChoices(card), [card]);
  const [picked, setPicked] = useState<string[]>(() => choices.filter((c) => /meeting|book|calendly/i.test(c.label)).slice(0, 1).map((c) => c.id));

  const cols = toolColours(card, ws);
  const colours = paletteChoice === "company" && cols.company ? cols.company : paletteChoice === "card" ? cols.card : DEFAULT_COLOURS;
  const logo = companyLogo(ws);
  // The signature is written in the language of the app: Arabic gives a right-to-left signature.
  const rtl = locale === "ar";

  const data: SignatureData = {
    name: card.name, title: card.title, company: card.company,
    phone: first(card, ["Mobile", "Landline", "WhatsApp"]), email: first(card, ["Email"]).replace(/^mailto:/i, ""),
    website: first(card, ["Website"]), address: card.address,
    photoUrl: card.photo_url, logoUrl: logo,
    qrUrl: `${API_PUBLIC_URL}/public/cards/${encodeURIComponent(card.public_code)}/qr.png?size=300`,
    cardUrl: card.public_url,
    buttons: choices.filter((c) => picked.includes(c.id)).map((c) => ({ label: c.label, href: c.href })),
  };
  const labels = signatureLabels(t);
  const options: SignatureOptions = { template, showPhoto, showQr, showButtons, colours, labels, rtl };
  const html = buildSignatureHtml(data, options);
  const text = buildSignatureText(data, { showButtons, labels, rtl });
  const problems = emailHtmlProblems(html);
  const testAddress = !/^https:/i.test(API_PUBLIC_URL);

  async function copySignature() {
    const ok = await copyRich(html, text);
    if (ok) announceFlag("signature_copied");
    toast(ok ? t("tools.sigCopied") : t("tools.sigCopyFailed"));
  }
  async function copySource() {
    toast((await copyText(wrapForSource(html))) ? t("tools.sigHtmlCopied") : t("tools.sigHtmlFailed"));
  }
  async function copyPlain() {
    toast((await copyText(text)) ? t("tools.sigTextCopied") : t("tools.sigTextFailed"));
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="card" size="s" /></span>{t("tools.sigStyle")}</h2></div>
          <div role="radiogroup" aria-label={t("tools.sigStyleAria")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            {TEMPLATES.map((tpl) => (
              <label key={tpl.key} style={{ border: `2px solid ${template === tpl.key ? "var(--orange)" : "var(--line)"}`, borderRadius: 14, padding: 12, cursor: "pointer", gap: 4, background: "#fff" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input className="chk" type="radio" name="template" checked={template === tpl.key} onChange={() => setTemplate(tpl.key)} />
                  <b>{t(tpl.name)}</b>
                </span>
                <span className="hint">{t(tpl.hint)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="settings" size="s" /></span>{t("tools.sigOptions")}</h2></div>
          <Row label={t("tools.sigShowPhoto")} checked={showPhoto} onChange={setShowPhoto} hint={template === "compact" || template === "minimal" ? t("tools.sigShowPhotoHint") : undefined} />
          <Row label={t("tools.sigShowQr")} checked={showQr} onChange={setShowQr} hint={t("tools.sigShowQrHint")} />
          <Row label={t("tools.sigShowButtons")} checked={showButtons} onChange={setShowButtons} hint={t("tools.sigShowButtonsHint")} />
          {showButtons && choices.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="hint" style={{ marginBottom: 6 }}>{t("tools.sigExtraButtons")}</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {choices.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <label key={c.id} className="pill" style={{ cursor: "pointer", flexDirection: "row", gap: 6, padding: "6px 12px", background: on ? "var(--ink)" : undefined, color: on ? "#fff" : undefined }}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && picked.length >= 3}
                        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                      />
                      {on && <Icon name="check" size="s" />}<bdi>{c.label}</bdi>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <label style={{ maxWidth: 320 }}>
            {t("tools.sigColours")}
            <select value={paletteChoice} onChange={(e) => setPaletteChoice(e.target.value as PaletteChoice)}>
              <option value="card">{t("tools.palCard")}</option>
              {cols.company && <option value="company">{t("tools.palCompany")}</option>}
              <option value="default">{t("tools.palDefault")}</option>
            </select>
          </label>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="mail" size="s" /></span>{t("tools.sigPreview")}</h2></div>
          <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: 18, overflowX: "auto" }} dir={rtl ? "rtl" : "ltr"} data-testid="signature-preview">
            <div style={{ color: "#555B66", fontFamily: rtl ? "Tahoma,Arial,sans-serif" : "Arial,Helvetica,sans-serif", fontSize: 13, marginBottom: 14 }}>{t("tools.sigRegards")}</div>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          {testAddress && (
            <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t("tools.sigTestAddress")}</div></div>
          )}
          {problems.length > 0 && <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow">{t("tools.sigProblems", { problems: list(problems.map((p) => t(PROBLEM_KEYS[p]))) })}</div></div>}
          <div className="row">
            <button type="button" className="btn" onClick={() => void copySignature()}><Icon name="copy" size="s" />{t("tools.sigCopy")}</button>
            <button type="button" className="btn ghost" onClick={() => void copySource()}>{t("tools.sigCopySource")}</button>
            <button type="button" className="btn ghost" onClick={() => void copyPlain()}>{t("tools.sigCopyPlain")}</button>
          </div>
          <div className="hint">{t("tools.sigBuiltHint")}</div>
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="check" size="s" /></span>{t("tools.sigHowTo")}</h2></div>
          <details open>
            <summary><b>Gmail</b></summary>
            <ol style={{ paddingInlineStart: 20, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              <li>{t("tools.sigGmail1")}</li>
              <li>{t("tools.sigGmail2")}</li>
              <li>{t("tools.sigGmail3")}</li>
              <li>{t("tools.sigGmail4")}</li>
            </ol>
          </details>
          <details>
            <summary><b>Outlook</b></summary>
            <ol style={{ paddingInlineStart: 20, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              <li>{t("tools.sigOutlook1")}</li>
              <li>{t("tools.sigOutlook2")}</li>
              <li>{t("tools.sigOutlook3")}</li>
              <li>{t("tools.sigOutlook4")}</li>
            </ol>
          </details>
          <details>
            <summary><b>Apple Mail</b></summary>
            <ol style={{ paddingInlineStart: 20, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              <li>{t("tools.sigApple1")}</li>
              <li>{t("tools.sigApple2")}</li>
              <li>{t("tools.sigApple3")}</li>
              <li>{t("tools.sigApple4")}</li>
            </ol>
          </details>
          <div className="hint">{t("tools.sigFallbackHint")}</div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle">
      <div>
        {label}
        {hint && <small>{hint}</small>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
