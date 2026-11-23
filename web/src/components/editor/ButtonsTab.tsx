"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { BrandGlyph, ButtonIcon } from "@/components/ButtonIcon";
import { Switch } from "@/components/app/Switch";
import { IconPicker } from "./IconPicker";
import s from "@/components/ops/ops.module.css";
import { FREE_ACCESS, buttonsAllLocked, buttonsHint, isKindAllowed } from "@/lib/ops/fields";
import { api } from "@/lib/api";
import {
  BUTTON_GROUPS, MAX_ITEMS, MAX_LABEL, REPEATABLE, addAnother, brandKeyOf, canAdd, indexesOfKind, isShown, moveOn, removeAt, setField,
  toggleBrand, toggleKind, type Btn,
} from "@/lib/card/buttons";
import { hostOf } from "@/lib/card/brand";
import { DOWNLOAD_KIND, MAX_DOWNLOAD_BYTES, MORE_KINDS, kindLinkProblem } from "@/lib/card/kind-rules";
import { uploadCardFile } from "@/lib/security-api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { tk } from "@/lib/i18n";
import { platformName, platformOf, platformPlaceholder } from "@/lib/card/catalogue";
import { hrefFor } from "@/lib/card/href";
import { isMeetingForm, meetingProblem, meetingProvider, meetingUrl } from "@/lib/card/meeting";
import { detectBrand, useBrandGlyphs, useBrandIndex, useDebounced } from "@/lib/icons-client";
import { useI18n } from "@/lib/i18n/client";
import type { ItemIcon, ItemKind } from "@/lib/types";
import type { EditorApi } from "./types";

export function ButtonsTab({ ed }: { ed: EditorApi }) {
  const { draft, update, card } = ed;
  const { t, number, list } = useI18n();
  const LIMIT_MSG = t("editor.limitReached", { n: MAX_ITEMS });
  const items = draft.items;
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase(), 200);
  const [picker, setPicker] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState("");
  const access = ed.access ?? FREE_ACCESS;
  const allLocked = buttonsAllLocked(access.buttons);
  const hint = buttonsHint(access.buttons, { t, list });
  const customOk = isKindAllowed("Custom", access.allowed_kinds);

  const setItems = (next: Btn[]) => {
    if (next.length > items.length && next.length > MAX_ITEMS) return setLimitMsg(LIMIT_MSG);
    setLimitMsg("");
    update({ items: next });
  };

  // After switching something on, put the cursor in its link field.
  useEffect(() => {
    if (!focus) return;
    const el = document.querySelector<HTMLInputElement>(`[data-focus="${CSS.escape(focus)}"]`);
    if (el) {
      el.focus({ preventScroll: false });
      setFocus(null);
    }
  }, [focus, items]);

  const switchKind = (kind: ItemKind, on: boolean) => {
    if (on && !canAdd(items) && indexesOfKind(items, kind).length === 0) return setLimitMsg(LIMIT_MSG);
    setItems(toggleKind(items, kind, on));
    if (on) setFocus(`kind:${kind}:0`);
  };

  const kindMatches = (kind: ItemKind) => {
    if (!isKindAllowed(kind, access.allowed_kinds)) return false;
    if (!dq) return true;
    const p = platformOf(kind);
    return p.name.toLowerCase().includes(dq) || platformName(kind, t).toLowerCase().includes(dq) || kind.toLowerCase().includes(dq);
  };

  // The kinds added later (documents, menus, review sites, stores) sit in their own group after the main ones.
  const groups = [...BUTTON_GROUPS, { title: tk("cardx.groupMore"), kinds: MORE_KINDS }]
    .map((g) => ({ ...g, kinds: g.kinds.filter(kindMatches) }))
    .filter((g) => g.kinds.length > 0);

  return (
    <div className="pane">
      {hint && <div className="notice" role="status"><Icon name="lock" /><div className="grow">{hint}</div></div>}
      {access.mandatory_buttons.length > 0 && (
        <div className="notice" role="status">
          <Icon name="lock" />
          <div className="grow">
            <b>{t("editor.requiredTitle")}</b>
            {t("editor.requiredText", { names: list(access.mandatory_buttons.map((m) => m.label || platformName(m.kind, t))) })}
          </div>
        </div>
      )}
      {access.allowed_kinds && <div className="hint">{t("editor.allowedKinds", { names: list(access.allowed_kinds.map((k) => platformName(k, t))) })}</div>}
      {access.banned_domains.length > 0 && <div className="hint">{t("editor.bannedDomains", { domains: list(access.banned_domains) })}</div>}
      {ed.itemsIssue && <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow"><b>{t("editor.notSavedTitle")}</b>{t("editor.notSavedText", { problem: ed.itemsIssue })}</div></div>}
      {ed.itemsHeld && !ed.itemsIssue && (
        <div className="notice warn" role="status">
          <Icon name="clock" />
          <div className="grow">
            <b>{t("editor.approvalTitle")}</b>
            {t("editor.approvalText")}
            <div className={`row ${s.heldBar}`} style={{ marginBlockStart: 8 }}>
              <button type="button" className="btn sm" onClick={() => void ed.sendItems?.()}>{t("editor.sendApproval")}</button>
              <button type="button" className="btn ghost sm" onClick={() => ed.discardItems?.()}>{t("editor.discard")}</button>
            </div>
          </div>
        </div>
      )}

      <fieldset disabled={allLocked} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <label className="search">
        <Icon name="search" size="s" />
        <input dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("editor.searchPlatforms", { n: number(3000) })} aria-label={t("editor.searchPlatformsAria")} />
      </label>

      {!dq && customOk && <AddAnyLink ed={ed} onLimit={() => setLimitMsg(LIMIT_MSG)} />}

      {limitMsg && <div className="notice warn" role="alert"><Icon name="alert" /><div className="grow">{limitMsg}</div></div>}

      {groups.map((g) => (
        <div className="pane" key={g.title} style={{ gap: 8 }}>
          <div className="sechead">{t(g.title)}</div>
          {g.kinds.map((kind) => (
            <PlatformRow key={kind} kind={kind} items={items} onSwitch={(on) => switchKind(kind, on)} setItems={setItems} cardId={card.id} />
          ))}
        </div>
      ))}

      {dq.length >= 2 && customOk && <BrandResults q={dq} items={items} setItems={setItems} setFocus={setFocus} />}
      {dq && groups.length === 0 && dq.length < 2 && <p className="hint">{t("editor.keepTyping")}</p>}

      <YourButtons ed={ed} onPick={setPicker} setItems={setItems} />
      <div className="hint">{t("editor.orderHint")}</div>
      </fieldset>

      {picker !== null && items[picker] && (
        <IconPicker
          cardId={card.id}
          current={items[picker].icon}
          onClose={() => setPicker(null)}
          onPick={(icon) => {
            setItems(setField(items, picker, { icon }));
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

/** One platform: its logo, name and switch, plus the link field(s) when switched on. */
function PlatformRow({ kind, items, onSwitch, setItems, cardId }: { kind: ItemKind; items: Btn[]; onSwitch: (on: boolean) => void; setItems: (n: Btn[]) => void; cardId: string }) {
  const { t } = useI18n();
  if (kind === "Meeting") return <MeetingRow items={items} onSwitch={onSwitch} setItems={setItems} />;
  if (kind === DOWNLOAD_KIND) return <DownloadRow items={items} onSwitch={onSwitch} setItems={setItems} cardId={cardId} />;
  const p = platformOf(kind);
  const name = platformName(kind, t);
  const idx = indexesOfKind(items, kind);
  const on = idx.some((i) => items[i].on);
  const shown = idx.filter((i) => items[i].on);
  const empty = on && shown.every((i) => !isShown(items[i]));
  return (
    <div className={`prow ${on ? "on" : ""}`} data-kind={kind}>
      <div className="prow-h">
        <span className="chip"><ButtonIcon kind={kind} /></span>
        <span className="grow"><b>{name}</b></span>
        <Switch checked={on} onChange={onSwitch} label={name} />
      </div>
      {on && (
        <>
          {shown.map((i, n) => (
            <div className="prow-f" key={i}>
              <input
                className="ltr"
                data-focus={`kind:${kind}:${n}`}
                value={items[i].value}
                placeholder={platformPlaceholder(kind, t)}
                aria-label={n > 0 ? t("editor.linkOrHandleN", { name, n: n + 1 }) : t("editor.linkOrHandle", { name })}
                inputMode={p.group === "contact" && kind !== "Email" && kind !== "Location" ? "tel" : "text"}
                autoComplete="off"
                onChange={(e) => setItems(setField(items, i, { value: e.target.value }))}
              />
              {n > 0 && (
                <button type="button" className="x del" aria-label={t("editor.removeThis", { name })} onClick={() => setItems(removeAt(items, i))}>
                  <Icon name="x2" size="s" />
                </button>
              )}
              {items[i].value.trim() && !hrefFor(kind, items[i].value) && <span className="err">{t("editor.linkNotAllowed")}</span>}
              {items[i].value.trim() && hrefFor(kind, items[i].value) && <KindProblem kind={kind} value={items[i].value} name={name} />}
            </div>
          ))}
          {empty && <div className="hint">{p.group === "contact" ? t("editor.addDetails", { name }) : t("editor.addLink", { name })}</div>}
          {REPEATABLE.includes(kind) && (
            <button type="button" className="linkbtn" style={{ alignSelf: "flex-start", fontSize: 12 }} onClick={() => { setItems(addAnother(items, kind)); }}>
              {t("editor.addAnother", { name: name.toLowerCase() })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** What is wrong with the link of a kind that has its own rules (https only, the right site), in the person's language. */
function KindProblem({ kind, value, name }: { kind: ItemKind; value: string; name: string }) {
  const { t } = useI18n();
  const problem = kindLinkProblem(kind, value);
  if (!problem) return null;
  return <span className="err" role="alert">{problem === "https" ? t("cardx.problemHttps") : problem === "site" ? t("cardx.problemSite", { name }) : t("cardx.problemUpload")}</span>;
}

/** The "Download file" button: the person uploads a PDF (up to 10 MB) and the button points at it. */
function DownloadRow({ items, onSwitch, setItems, cardId }: { items: Btn[]; onSwitch: (on: boolean) => void; setItems: (n: Btn[]) => void; cardId: string }) {
  const { t, number } = useI18n();
  const name = platformName(DOWNLOAD_KIND, t);
  const idx = indexesOfKind(items, DOWNLOAD_KIND);
  const at = idx.find((i) => items[i].on);
  const on = at !== undefined;
  const value = on ? items[at].value : "";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function pick(file: File | undefined) {
    if (!file || at === undefined) return;
    setErr("");
    if (file.size > MAX_DOWNLOAD_BYTES) return setErr(t("cardx.fileTooBig", { mb: number(10) }));
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return setErr(t("cardx.notPdf"));
    setBusy(true);
    try {
      const r = await uploadCardFile(cardId, file);
      const label = items[at].label || file.name.replace(/\.pdf$/i, "").slice(0, MAX_LABEL);
      setItems(setField(items, at, { value: r.file_url, label }));
    } catch (e) {
      setErr(apiErrorText(e, t, "cardx.uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`prow ${on ? "on" : ""}`} data-kind={DOWNLOAD_KIND}>
      <div className="prow-h">
        <span className="chip"><ButtonIcon kind={DOWNLOAD_KIND} /></span>
        <span className="grow"><b>{name}</b></span>
        <Switch checked={on} onChange={onSwitch} label={name} />
      </div>
      {on && at !== undefined && (
        <div className="prow-f" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <input dir="auto" value={items[at].label} maxLength={MAX_LABEL} placeholder={t("editor.buttonName")} aria-label={t("editor.buttonName")} onChange={(e) => setItems(setField(items, at, { label: e.target.value }))} />
          <label className="btn ghost sm" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
            {busy ? t("cardx.uploading") : value ? t("cardx.replaceFile") : t("cardx.chooseFile", { mb: number(10) })}
            <input type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {value && !err && <span className="hint" role="status">{t("cardx.fileReady")} <a href={value} target="_blank" rel="noopener noreferrer">{t("cardx.openFile")}</a></span>}
          {err && <span className="err" role="alert">{err}</span>}
          {!value && !err && <span className="hint">{t("cardx.fileHint")}</span>}
        </div>
      )}
    </div>
  );
}

/** Brands from the full logo list that are not in the platform list. */
function BrandResults({ q, items, setItems, setFocus }: { q: string; items: Btn[]; setItems: (n: Btn[]) => void; setFocus: (f: string | null) => void }) {
  const { t, number } = useI18n();
  const index = useBrandIndex(true);
  const builtIn = useMemo(() => new Set(["whatsapp", "googlemaps", "facebook", "instagram", "linkedin", "x", "youtube", "tiktok", "snapchat", "telegram", "pinterest", "threads", "github", "behance", "dribbble", "discord", "spotify", "soundcloud", "twitch", "reddit", "medium", "calendly", "apple", "googleplay", "paypal"]), []);
  const rows = useMemo(() => {
    if (!index.data) return [];
    const a: typeof index.data = [];
    const b: typeof index.data = [];
    for (const r of index.data) {
      if (builtIn.has(r[0])) continue;
      const t = r[1].toLowerCase();
      if (t.startsWith(q) || r[0].startsWith(q)) a.push(r);
      else if (t.includes(q) || r[0].includes(q)) b.push(r);
      if (a.length >= 24) break;
    }
    return [...a, ...b].slice(0, 24);
  }, [index, q, builtIn]);
  const glyphs = useBrandGlyphs(rows.map((r) => r[0]));

  return (
    <div className="pane" style={{ gap: 8 }}>
      <div className="sechead">{t("editor.brandsHead")}</div>
      {index.isLoading && <p className="hint">{t("editor.brandsSearching", { n: number(3000) })}</p>}
      {index.data && rows.length === 0 && <p className="hint">{t("editor.brandsNone")}</p>}
      {rows.map(([slug, title]) => {
        const at = items.findIndex((it) => brandKeyOf(it) === slug);
        const on = at >= 0 && items[at].on;
        const g = glyphs.data?.[slug];
        return (
          <div className={`prow ${on ? "on" : ""}`} key={slug}>
            <div className="prow-h">
              <span className="chip">{g ? <BrandGlyph path={g.path} /> : <span className="skeleton" style={{ width: 20, height: 20 }} />}</span>
              <span className="grow"><b>{title}</b></span>
              <Switch
                checked={on}
                label={title}
                onChange={(v) => {
                  setItems(toggleBrand(items, slug, title, v));
                  if (v) setFocus(`brand:${slug}`);
                }}
              />
            </div>
            {on && (
              <div className="prow-f">
                <input
                  className="ltr"
                  data-focus={`brand:${slug}`}
                  value={items[at].value}
                  placeholder={t("editor.brandLinkPlaceholder", { name: title })}
                  aria-label={t("editor.linkAria", { name: title })}
                  autoComplete="off"
                  onChange={(e) => setItems(setField(items, at, { value: e.target.value }))}
                />
                {!isShown(items[at]) && <div className="hint">{t("editor.addLink", { name: title })}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Paste a link, email or phone number; the logo and a name are found automatically. */
function AddAnyLink({ ed, onLimit }: { ed: EditorApi; onLimit: () => void }) {
  const { draft, update } = ed;
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [found, setFound] = useState<{ value: string; label: string; icon: ItemIcon | null; glyph?: string; image?: string } | null>(null);

  async function find() {
    const v = text.trim();
    if (!v) return;
    setErr("");
    if (!canAdd(draft.items)) return onLimit();
    const href = hrefFor("Custom", v);
    if (!href) return setErr(t("editor.addAnyBad"));
    setBusy(true);
    try {
      const isMail = href.startsWith("mailto:");
      const isTel = href.startsWith("tel:");
      if (isTel) {
        setFound({ value: v, label: t("editor.labelCall"), icon: { type: "lucide", key: "phone", image_url: null } });
      } else if (isMail) {
        const host = hostOf(v);
        const brand = host ? await detectBrand(host).catch(() => null) : null;
        const mailBrand = brand && ["gmail", "protonmail", "icloud", "yahoo", "fastmail", "tutanota", "zoho", "gmx"].includes(brand.slug) ? brand : null;
        setFound({
          value: v, label: mailBrand ? t("editor.labelEmailBrand", { brand: mailBrand.title }) : t("editor.labelEmail"),
          icon: mailBrand ? { type: "brand", key: mailBrand.slug, image_url: null } : { type: "lucide", key: "mail", image_url: null },
          glyph: mailBrand?.path,
        });
      } else if (/^https?:/i.test(href)) {
        const r = await api.resolveLink(href).catch(() => null);
        const url = r?.url || href;
        const host = hostOf(url);
        const brand = host ? await detectBrand(host).catch(() => null) : null;
        const title = (r?.title || "").trim();
        setFound({
          value: url,
          label: (brand?.title || title || host || t("editor.labelLink")).slice(0, MAX_LABEL),
          icon: brand ? { type: "brand", key: brand.slug, image_url: null } : r?.favicon_url ? { type: "upload", key: null, image_url: r.favicon_url } : null,
          glyph: brand?.path,
          image: !brand ? r?.favicon_url ?? undefined : undefined,
        });
      } else {
        setFound({ value: v, label: t("editor.labelLink"), icon: null });
      }
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (!found) return;
    update({ items: [...draft.items, { kind: "Custom", value: found.value, label: found.label.slice(0, MAX_LABEL), on: true, icon: found.icon }] });
    setFound(null);
    setText("");
  }

  return (
    <div className="prow on" style={{ background: "var(--surface-2)" }}>
      <div className="prow-h">
        <span className="chip"><Icon name="link" size="s" /></span>
        <span className="grow"><b>{t("editor.addAnyTitle")}</b><span className="hint" style={{ display: "block" }}>{t("editor.addAnyHint")}</span></span>
      </div>
      <form className="copybox" onSubmit={(e) => { e.preventDefault(); void find(); }}>
        <input className="ltr" value={text} onChange={(e) => { setText(e.target.value); setFound(null); setErr(""); }} placeholder="https://  name@email.com  +974..." aria-label={t("editor.addAnyAria")} autoComplete="off" />
        <button type="submit" className="btn sm" disabled={busy || !text.trim()}>{busy ? "..." : t("editor.find")}</button>
      </form>
      {err && <span className="err" role="alert">{err}</span>}
      {found && (
        <div className="prow-f" style={{ gap: 10 }}>
          <span className="chip">
            {found.glyph ? <BrandGlyph path={found.glyph} /> : found.image ? <img src={found.image} alt="" width={20} height={20} /> : found.icon?.type === "lucide" ? <ButtonIcon kind="Custom" res={{ t: "lucide", key: found.icon.key ?? "link" }} /> : <Icon name="link" />}
          </span>
          <input dir="auto" value={found.label} maxLength={MAX_LABEL} onChange={(e) => setFound({ ...found, label: e.target.value })} aria-label={t("editor.buttonName")} />
          <button type="button" className="btn sm" onClick={add}>{t("common.add")}</button>
        </div>
      )}
    </div>
  );
}

/** The buttons that are on the card, with order, show/hide, logo and remove. */
function YourButtons({ ed, onPick, setItems }: { ed: EditorApi; onPick: (i: number) => void; setItems: (n: Btn[]) => void }) {
  const { draft, icons } = ed;
  const { t, number } = useI18n();
  const items = draft.items;
  const rows = items.map((it, i) => ({ it, i })).filter(({ it }) => it.on || it.kind === "Custom");
  const shown = items.filter(isShown).length;
  return (
    <div className="pane" style={{ gap: 8 }}>
      <div className="sechead">{t("editor.yourButtons")} <span className="pill dark">{t("editor.onTheCard", { n: number(shown) })}</span></div>
      {rows.length === 0 && <div className="hint">{t("editor.yourButtonsEmpty")}</div>}
      {rows.map(({ it, i }) => {
        const name = platformName(it.kind, t);
        const custom = it.kind === "Custom";
        return (
          <div className={`irow ${it.on ? "" : "off"}`} key={i}>
            <span className="chip"><ButtonIcon kind={it.kind} res={icons[i]} /></span>
            <div className="mid">
              {custom ? (
                <>
                  <input dir="auto" value={it.label} maxLength={MAX_LABEL} placeholder={t("editor.buttonName")} aria-label={t("editor.buttonName")} onChange={(e) => setItems(setField(items, i, { label: e.target.value }))} />
                  <input className="ltr" value={it.value} placeholder={t("editor.linkEmailPhone")} aria-label={t("editor.linkAria", { name: it.label || name })} onChange={(e) => setItems(setField(items, i, { value: e.target.value }))} />
                  {it.value.trim() && !hrefFor("Custom", it.value) && <span className="err">{t("editor.linkNotAllowed")}</span>}
                </>
              ) : (
                <>
                  <b>{name}</b>
                  {it.kind === "Meeting" && isMeetingForm(it.value) ? (
                    <span className="mono" style={{ overflowWrap: "anywhere" }}>{t("editor.builtInForm")}</span>
                  ) : it.value ? (
                    <span className="mono ltr" style={{ overflowWrap: "anywhere" }}>{it.value}</span>
                  ) : (
                    <span className="mono" style={{ overflowWrap: "anywhere" }}>{t("editor.noValue")}</span>
                  )}
                </>
              )}
              <button type="button" className="linkbtn" style={{ alignSelf: "flex-start", fontSize: 12 }} onClick={() => onPick(i)}>{t("editor.changeLogo")}</button>
            </div>
            <div className="ctl">
              <Switch checked={it.on} label={t("editor.showOnCard", { name: custom ? it.label || name : name })} onChange={(on) => setItems(setField(items, i, { on }))} />
              <button type="button" className="x" aria-label={t("editor.moveUp")} onClick={() => setItems(moveOn(items, i, -1))}><Icon name="chev" size="s" style={{ transform: "rotate(-90deg)" }} /></button>
              <button type="button" className="x" aria-label={t("editor.moveDown")} onClick={() => setItems(moveOn(items, i, 1))}><Icon name="chev" size="s" style={{ transform: "rotate(90deg)" }} /></button>
              {custom && <button type="button" className="x del" aria-label={t("common.remove")} onClick={() => setItems(removeAt(items, i))}><Icon name="x2" size="s" /></button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The Meeting button: the person's own booking link, or the built-in request form. */
function MeetingRow({ items, onSwitch, setItems }: { items: Btn[]; onSwitch: (on: boolean) => void; setItems: (n: Btn[]) => void }) {
  const { t } = useI18n();
  const name = platformName("Meeting", t);
  const idx = indexesOfKind(items, "Meeting");
  const at = idx.find((i) => items[i].on);
  const on = at !== undefined;
  const value = on ? items[at].value : "";
  const form = isMeetingForm(value);
  const problem = on && !form ? meetingProblem(value, t) : null;
  const provider = on && !form && !problem ? meetingProvider(value) : null;
  const url = on && !form && !problem ? meetingUrl(value) : null;
  return (
    <div className={`prow ${on ? "on" : ""}`} data-kind="Meeting">
      <div className="prow-h">
        <span className="chip"><Icon name="clock" size="s" /></span>
        <span className="grow"><b>{name}</b></span>
        <Switch checked={on} onChange={onSwitch} label={name} />
      </div>
      {on && at !== undefined && (
        <>
          <div role="radiogroup" aria-label={t("editor.meetHow")} className="row" style={{ gap: 14 }}>
            <label className="chkrow">
              <input className="chk" type="radio" name="meeting-mode" checked={!form} onChange={() => setItems(setField(items, at, { value: form ? "" : value }))} />
              {t("editor.meetMyLink")}
            </label>
            <label className="chkrow">
              <input className="chk" type="radio" name="meeting-mode" checked={form} onChange={() => setItems(setField(items, at, { value: "form" }))} />
              {t("editor.builtInForm")}
            </label>
          </div>
          {form ? (
            <div className="hint">{t("editor.meetFormHint")}</div>
          ) : (
            <>
              <div className="prow-f">
                <input
                  className="ltr"
                  data-focus="kind:Meeting:0"
                  value={value}
                  placeholder={platformPlaceholder("Meeting", t)}
                  aria-label={t("editor.meetLinkAria")}
                  inputMode="url"
                  autoComplete="off"
                  onChange={(e) => setItems(setField(items, at, { value: e.target.value }))}
                />
                {url && (
                  <a className="btn ghost sm" href={url} target="_blank" rel="noopener noreferrer">{t("editor.meetTest")}</a>
                )}
              </div>
              {problem && <span className="err" role="alert">{problem}</span>}
              {provider && <div className="hint" role="status">{t("editor.meetRecognised", { name: provider.name })}</div>}
              <div className="hint">{t("editor.meetPasteHint")}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}
