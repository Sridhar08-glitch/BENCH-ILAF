"use client";

// The brief a company sends to ask for a custom card design, in plain words, with files.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { designsApi, errorText, type BriefInput } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export function RequestForm({ wsId, followsFace, onDone }: { wsId: string; followsFace?: number | null; onDone?: (id: string) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState<BriefInput & { links: string }>({
    goals: "", brand_assets_notes: "", style_examples: [], links: "", languages: "both", deadline: null, employees_count: null, notes: "", allow_team_names: false,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [missing, setMissing] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.goals.trim()) { setMissing(true); return; }
    setBusy(true); setErr(""); setMissing(false);
    try {
      const links = f.links.split(/\s+/).filter(Boolean);
      const { links: _l, ...body } = f;
      void _l;
      const made = await designsApi.create(wsId, { ...body, style_examples: links, follows_face: followsFace ?? null });
      for (const file of files.slice(0, 10)) {
        try { await designsApi.upload(wsId, made.id, file); } catch (x) { setErr(errorText(x, t)); }
      }
      await qc.invalidateQueries({ queryKey: ["design-requests", wsId] });
      if (onDone) onDone(made.id); else router.push(`/app/requests/${made.id}`);
    } catch (x) { setErr(errorText(x, t)); } finally { setBusy(false); }
  }

  return (
    <form className="pane" onSubmit={(e) => void submit(e)} noValidate style={{ gap: 14, maxWidth: 680 }}>
      <label className="fg">
        <b>{t("designs.formGoals")}</b>
        <span className="hint">{t("designs.formGoalsHint")}</span>
        <textarea rows={4} value={f.goals} onChange={(e) => set("goals", e.target.value)} aria-invalid={missing} maxLength={4000} />
        {missing && <span className="err" role="alert">{t("designs.formGoalsMissing")}</span>}
      </label>
      <label className="fg">
        <b>{t("designs.formAssets")}</b>
        <span className="hint">{t("designs.formAssetsHint")}</span>
        <textarea rows={2} value={f.brand_assets_notes} onChange={(e) => set("brand_assets_notes", e.target.value)} maxLength={3000} />
      </label>
      <div className="fg">
        <b>{t("designs.formFiles")}</b>
        <span className="hint">{t("designs.formFilesHint")}</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn ghost sm" onClick={() => pick.current?.click()}><Icon name="upload" size="s" /> {t("designs.attach")}</button>
          <input ref={pick} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFiles((x) => [...x, ...Array.from(e.target.files ?? [])].slice(0, 10))} />
          {files.map((x, i) => (
            <span key={i} className="pill">{x.name} <button type="button" className="linkbtn" aria-label={t("designs.removeFile")} onClick={() => setFiles((l) => l.filter((_, k) => k !== i))}>x</button></span>
          ))}
        </div>
      </div>
      <label className="fg">
        <b>{t("designs.formLinks")}</b>
        <span className="hint">{t("designs.formLinksHint")}</span>
        <textarea rows={2} value={f.links} onChange={(e) => set("links", e.target.value)} placeholder="https://" />
      </label>
      <div className="g2">
        <label className="fg">
          <b>{t("designs.formLanguages")}</b>
          <select value={f.languages} onChange={(e) => set("languages", e.target.value as BriefInput["languages"])}>
            <option value="en">{t("designs.langEn")}</option>
            <option value="ar">{t("designs.langAr")}</option>
            <option value="both">{t("designs.langBoth")}</option>
          </select>
        </label>
        <label className="fg">
          <b>{t("designs.formDeadline")}</b>
          <input type="date" value={f.deadline ?? ""} onChange={(e) => set("deadline", e.target.value || null)} />
        </label>
        <label className="fg">
          <b>{t("designs.formEmployees")}</b>
          <input type="number" min={1} value={f.employees_count ?? ""} onChange={(e) => set("employees_count", e.target.value ? Number(e.target.value) : null)} />
        </label>
      </div>
      <label className="fg">
        <b>{t("designs.formNotes")}</b>
        <textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={3000} />
      </label>
      <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={f.allow_team_names} onChange={(e) => set("allow_team_names", e.target.checked)} />
        <span>{t("designs.formTeamNames")}</span>
      </label>
      {err && <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow">{err}</div></div>}
      <div><button className="btn" disabled={busy}>{busy ? t("designs.sending") : t("designs.formSubmit")}</button></div>
    </form>
  );
}
