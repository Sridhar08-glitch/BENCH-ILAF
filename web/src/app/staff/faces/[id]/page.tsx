"use client";

// The face studio: the template and the CSS on the left, the card on four sample people in all four colourways on
// the right, with the safety check's warnings, the contrast of the colourways, an overlap check and the version history.
import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaceStage, STAGE_PEOPLE } from "@/components/designs/shared";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { warningText } from "@/components/staff/warnings";
import { errorText, staffApi, type StudioFace } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";
import { cr } from "@/lib/library/company/colour";
import { sanitizeFace } from "@/lib/library/custom/sanitize";
import { ownMedia } from "@/lib/library/custom/render";
import type { CustomFaceData, CustomFacePalette } from "@/lib/library/custom/types";

/** A plain text box with line numbers beside it. */
function CodeBox({ value, onChange, label, rows = 16 }: { value: string; onChange: (v: string) => void; label: string; rows?: number }) {
  const gutter = useRef<HTMLPreElement>(null);
  const lines = Math.max(rows, value.split("\n").length);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }} dir="ltr">
      <pre ref={gutter} aria-hidden="true" className="mono" style={{ margin: 0, padding: "8px 8px", textAlign: "right", color: "var(--micro)", background: "var(--surface-2)", fontSize: 12, lineHeight: "18px", overflow: "hidden", height: rows * 18 + 16 }}>
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </pre>
      <textarea
        aria-label={label} value={value} spellCheck={false} wrap="off" onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
        className="mono" style={{ border: 0, borderRadius: 0, fontSize: 12, lineHeight: "18px", padding: 8, height: rows * 18 + 16, resize: "vertical", outline: "none", whiteSpace: "pre", overflow: "auto", minHeight: 0 }}
      />
    </div>
  );
}

const nameOf = (e: Element) => (e.getAttribute("class") ?? "").split(" ")[0] || e.tagName.toLowerCase();

function hashOf(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CHECKS: [keyof CustomFacePalette, keyof CustomFacePalette, number][] = [["fg", "bg", 4.5], ["fg", "bg2", 4.5], ["on", "acc", 3]];

export default function Studio({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  const id = Number(raw);
  const q = useQuery({ queryKey: ["staff-face", id], queryFn: () => staffApi.face(id) });
  if (q.isLoading) return <SkeletonBlocks rows={4} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  return <StudioBody key={q.data.id} face={q.data} />;
}

function StudioBody({ face }: { face: StudioFace }) {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(face.name);
  const [template, setTemplate] = useState(face.template);
  const [css, setCss] = useState(face.css);
  const [palettes, setPalettes] = useState<CustomFacePalette[]>(face.palettes);
  const [fontLocked, setFontLocked] = useState(face.font_locked);
  const [wide, setWide] = useState(false);
  const [persona, setPersona] = useState(0);
  const [photo, setPhoto] = useState(true);
  const [logo, setLogo] = useState(true);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [issues, setIssues] = useState<string[] | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const dirty = name !== face.name || template !== face.template || css !== face.css || fontLocked !== face.font_locked || JSON.stringify(palettes) !== JSON.stringify(face.palettes);

  const brandJson = useMemo(() => ({ company_name: face.company.name, logo_url: face.company.logo_url, palette: face.company.palette }), [face.company]);
  const media = useMemo(() => ownMedia({ companyName: "", logoUrl: face.company.logo_url }), [face.company.logo_url]);
  // What the page will show: the text goes through the same safety check as on the server, on every keystroke.
  const checked = useMemo(() => sanitizeFace(template, css, face.id, media), [template, css, face.id, media]);
  const live = useMemo<CustomFaceData>(
    () => ({ id: face.id, name, tags: face.tags, palettes, template: checked.template, css: checked.css, font_locked: fontLocked, version: face.version, hash: "s" + hashOf(checked.template + "|" + checked.css + "|" + JSON.stringify(palettes)) }),
    [face.id, face.tags, face.version, name, palettes, checked, fontLocked],
  );
  const problems = [...checked.warnings, ...checked.errors.map((e) => ({ ...e, count: 1, params: {} }))];

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const run = async (fn: () => Promise<void>) => { setErr(""); try { await fn(); } catch (e) { setErr(errorText(e, t)); } };
  const put = (f: StudioFace) => { qc.setQueryData(["staff-face", face.id], f); void qc.invalidateQueries({ queryKey: ["staff-request"] }); };
  const save = () => run(async () => { const f = await staffApi.saveFace(face.id, { name, template, css, palettes, font_locked: fontLocked }); put(f); toast(t("staff.saved")); });

  function overlapCheck() {
    const out: string[] = [];
    area.current?.querySelectorAll<HTMLElement>(".card").forEach((card, k) => {
      const f = card.querySelector<HTMLElement>(".face:not(.back)");
      if (!f) return;
      const fr = f.getBoundingClientRect();
      const text = Array.from(f.querySelectorAll<HTMLElement>(".n,.t1,.cl,.ln"));
      const blocks = Array.from(f.querySelectorAll<HTMLElement>(".pw,.pic,.lg,.cfm,svg:not(.ico)")).filter((b) => !b.closest(".ln"));
      for (const el of text) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if (r.left < fr.left - 1 || r.right > fr.right + 1 || r.top < fr.top - 1 || r.bottom > fr.bottom + 1) out.push(t("staff.checkClip", { n: k + 1, el: nameOf(el) }));
        for (const b of blocks) {
          if (b.contains(el) || el.contains(b)) continue;
          const o = b.getBoundingClientRect();
          if (r.left < o.right - 1 && r.right > o.left + 1 && r.top < o.bottom - 1 && r.bottom > o.top + 1) out.push(t("staff.issueOverlap", { n: k + 1, el: nameOf(el), other: nameOf(b) }));
        }
      }
    });
    setIssues([...new Set(out)]);
  }

  const person = STAGE_PEOPLE[persona];
  const statusActions = (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <button className="btn" disabled={!dirty} onClick={() => void save()}>{t("staff.save")}</button>
      <button className="btn ghost" onClick={() => void run(async () => { if (dirty) await save(); put(await staffApi.newVersion(face.id, note)); setNote(""); toast(t("staff.versionSaved")); })}>{t("staff.saveVersion")}</button>
      {(face.status === "draft" || face.status === "in_review") && (
        <button className="btn ghost" onClick={() => void run(async () => { if (dirty) await save(); const r = await staffApi.sendForReview(face.id); setLink(r.preview_url); put(await staffApi.face(face.id)); })}>{t("staff.sendForReview")}</button>
      )}
      {face.status === "approved" && <button className="btn accent" onClick={() => void run(async () => put(await staffApi.faceAction(face.id, "publish")))}>{t("staff.publish")}</button>}
      {face.status !== "disabled" && <button className="btn danger" onClick={() => { if (window.confirm(t("staff.disableConfirm", { n: face.affected_cards }))) void run(async () => put(await staffApi.faceAction(face.id, "disable"))); }}>{t("staff.disable")}</button>}
      {face.status === "disabled" && <button className="btn ghost" onClick={() => void run(async () => put(await staffApi.faceAction(face.id, "enable")))}>{t("staff.enable")}</button>}
    </div>
  );

  return (
    <div className="view">
      <div className="row" style={{ flexWrap: "wrap" }}>
        {face.request ? <Link className="btn ghost sm" href={`/staff/requests/${face.request.id}`}>{t("staff.back")}</Link> : <Link className="btn ghost sm" href="/staff/design-requests">{t("staff.back")}</Link>}
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t("staff.faceName")} style={{ maxWidth: 260 }} />
        <span className="pill">{t("staff.faceStatus", { status: face.status, version: face.version })}</span>
        <span className="hint">{face.company.name}</span>
        {dirty && <span className="pill warn">{t("staff.unsaved")}</span>}
      </div>
      {statusActions}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("staff.versionNote")} aria-label={t("staff.versionNote")} style={{ maxWidth: 360 }} />
      {err && <div className="notice bad" role="alert"><div className="grow">{err}</div></div>}
      {link && (
        <div className="notice"><div className="grow"><b>{t("staff.previewLink")}</b><div><a href={link} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all" }}>{link}</a></div><span className="hint">{t("staff.previewLinkText")}</span></div></div>
      )}

      <div className="studio" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="pane">
          <label className="fg"><b>{t("staff.template")}</b><CodeBox value={template} onChange={setTemplate} label={t("staff.template")} /></label>
          <label className="fg"><b>{t("staff.css")}</b><CodeBox value={css} onChange={setCss} label={t("staff.css")} /></label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={fontLocked} onChange={(e) => setFontLocked(e.target.checked)} />{t("staff.fontLocked")}</label>

          <section className="panel" style={{ padding: 12, display: "grid", gap: 8 }}>
            <h2>{t("staff.warnings")}</h2>
            {problems.length === 0 ? <span className="hint">{t("staff.nothingRemoved")}</span> : (
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {problems.map((w, i) => <li key={i}>{warningText(w, t)}{w.count > 1 ? ` (x${w.count})` : ""}</li>)}
              </ul>
            )}
          </section>

          <section className="panel" style={{ padding: 12, display: "grid", gap: 8 }}>
            <h2>{t("staff.colourways")}</h2>
            {palettes.map((p, i) => (
              <div key={i} style={{ display: "grid", gap: 6 }}>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <input value={p.name} onChange={(e) => setPalettes((l) => l.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} aria-label={t("staff.paletteName")} style={{ maxWidth: 130 }} />
                  {(["bg", "bg2", "fg", "acc", "on"] as const).map((key) => (
                    <label key={key} className="row" style={{ gap: 4 }}>
                      <small>{key}</small>
                      <input type="color" value={p[key]} aria-label={`${p.name} ${key}`} style={{ width: 40, height: 30, padding: 1 }} onChange={(e) => setPalettes((l) => l.map((x, k) => (k === i ? { ...x, [key]: e.target.value } : x)))} />
                    </label>
                  ))}
                </div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {CHECKS.map(([a, b, min]) => {
                    const ratio = cr(p[a], p[b]);
                    return <span key={a + b} className={`pill ${ratio >= min ? "ok" : "bad"}`}>{a}/{b} {ratio.toFixed(1)}:1 {ratio >= min ? t("staff.contrastOk") : t("staff.contrastLow", { min })}</span>;
                  })}
                </div>
              </div>
            ))}
          </section>

          <section className="panel" style={{ padding: 12, display: "grid", gap: 6 }}>
            <h2>{t("staff.versions")}</h2>
            {face.versions.map((v) => (
              <div key={v.number} className="row">
                <b>v{v.number}</b><span className="hint grow">{v.note || v.name} · {dateTime(v.created_at)} · {v.by}</span>
                <button className="btn ghost sm" onClick={() => { if (!dirty || window.confirm(t("staff.restoreConfirm"))) void run(async () => { put(await staffApi.restore(face.id, v.number)); toast(t("staff.restored")); }); }}>{t("staff.restore")}</button>
              </div>
            ))}
            <h2>{t("staff.previews")}</h2>
            {face.previews.map((p) => (
              <div key={p.id} className="row"><span className="pill">{p.state}</span><span className="hint grow">{dateTime(p.expires_at)} · {t("staff.views", { n: p.views })}</span>
                {p.state === "active" && <button className="btn ghost sm" onClick={() => void run(async () => { await staffApi.revokePreview(face.id, p.id); put(await staffApi.face(face.id)); })}>{t("staff.revoke")}</button>}
              </div>
            ))}
            <div><button className="btn ghost sm" onClick={() => void run(async () => { const r = await staffApi.newPreview(face.id); setLink(r.preview_url); put(await staffApi.face(face.id)); })}>{t("staff.newLink")}</button></div>
          </section>
        </div>

        <div className="pane" style={{ position: "sticky", top: 8 }}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <div className="seg" role="group" aria-label={t("staff.device")}>
              <button type="button" className={`btn sm ${wide ? "ghost" : ""}`} aria-pressed={!wide} onClick={() => setWide(false)}>{t("staff.phone")}</button>
              <button type="button" className={`btn sm ${wide ? "" : "ghost"}`} aria-pressed={wide} onClick={() => setWide(true)}>{t("staff.desktop")}</button>
            </div>
            <select value={persona} onChange={(e) => setPersona(Number(e.target.value))} aria-label={t("staff.person")}>
              {STAGE_PEOPLE.map((p, i) => <option key={p.id} value={i}>{t(p.label)}</option>)}
            </select>
            <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />{t("staff.withPhoto")}</label>
            <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} />{t("staff.withLogo")}</label>
            <button className="btn ghost sm" onClick={overlapCheck}>{t("staff.checkOverlap")}</button>
          </div>
          {issues && (
            <div className={`notice ${issues.length ? "warn" : ""}`} role="status"><div className="grow">{issues.length ? <ul style={{ margin: 0, paddingInlineStart: 18 }}>{issues.map((x) => <li key={x}>{x}</li>)}</ul> : t("staff.checkClean")}</div></div>
          )}
          <div ref={area} style={{ display: "grid", gridTemplateColumns: wide ? "1fr 1fr" : "1fr", gap: 12, maxWidth: wide ? 820 : 380 }}>
            {[0, 1, 2, 3].map((c) => (
              <div key={c} style={{ display: "grid", gap: 4 }}>
                <small className="hint">{palettes[c].name}</small>
                <FaceStage face={live} colour={c} person={person} companyName={face.company.name} brandJson={brandJson} photo={photo} logo={logo} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@media(max-width:900px){.studio{grid-template-columns:1fr!important}}`}</style>
    </div>
  );
}
