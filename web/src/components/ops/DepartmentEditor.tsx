"use client";

// Create or change a department: its name, its own card design (the same picker the card editor uses) and its buttons.
import { useMemo, useState } from "react";
import { DesignTab } from "@/components/editor/DesignTab";
import type { EditorApi } from "@/components/editor/types";
import { ToggleRow } from "@/components/app/Switch";
import { ErrorBox } from "@/components/app/ui";
import { ApiError, api } from "@/lib/api";
import { PEOPLE, SAMPLE_ITEMS } from "@/lib/brand/sample";
import { apiFirstFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n";
import { normalizeDesign } from "@/lib/library";
import { toCompanyBrand } from "@/lib/library/company/brand";
import { MAX_DEPARTMENT_NAME, buttonsProblem, fullDesign, nameProblem } from "@/lib/ops/departments";
import type { Card, Department, Design, WorkspaceDetail } from "@/lib/types";
import { ButtonListEditor } from "./ButtonListEditor";
import s from "./ops.module.css";

/** The first message the API sent for a department save, in plain words. */
function problemOf(e: unknown, t: TFunction): string {
  if (!(e instanceof ApiError)) return t("company.deptSaveFailed");
  return apiFirstFieldText(e, t);
}

export function DepartmentEditor({ ws, initial, others, onSaved, onCancel }: {
  ws: WorkspaceDetail;
  initial: Department | null;
  others: Department[];
  onSaved: (d: Department) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const companyDesign = useMemo(() => normalizeDesign(ws.brand.design), [ws.brand.design]);
  const [name, setName] = useState(initial?.name ?? "");
  const [own, setOwn] = useState(Object.keys(initial?.design ?? {}).length > 0);
  const [design, setDesign] = useState<Design>(() => ({ ...companyDesign, ...fullDesign(initial?.design, companyDesign) }));
  const [items, setItems] = useState(initial?.items ?? []);
  const [must, setMust] = useState(initial?.mandatory_items ?? []);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const nameErr = nameProblem(name, others, initial?.id, t);
  const itemsErr = buttonsProblem(items, t);
  const mustErr = buttonsProblem(must, t);
  const companyBrand = useMemo(() => toCompanyBrand(ws.brand), [ws.brand]);
  const who = PEOPLE[0];

  const sampleCard = useMemo<Card>(
    () => ({
      id: "department", workspace_id: ws.id, owner: null, public_code: "sample", public_url: "", slug: null, status: "draft",
      name: who.name, title: who.title, company: ws.brand.company_name || ws.name, address: "", photo_url: null,
      save_contact: true, vc: { company: true, photo: true, phones: true, emails: true, urls: true, social: true, addr: true, note: "" },
      design, items: SAMPLE_ITEMS as Card["items"], created_at: "", updated_at: "", stats: { views: 0, scans: 0, saves: 0, leads: 0 },
    }),
    [design, who, ws.brand.company_name, ws.id, ws.name],
  );
  const [replay, setReplay] = useState(0);
  void replay;
  const ed: EditorApi = {
    card: sampleCard,
    draft: { name: sampleCard.name, title: sampleCard.title, company: sampleCard.company, address: "", save_contact: true, vc: sampleCard.vc, design, items: sampleCard.items },
    update: (p) => p.design && setDesign(p.design as Design),
    patchNow: () => undefined,
    locked: false,
    icons: [],
    setPhoto: () => undefined,
    setCover: () => undefined,
    canCover: false,
    brand: companyBrand,
    replay: () => setReplay((n) => n + 1),
  };

  async function save() {
    setTried(true);
    if (nameErr || itemsErr || mustErr) return;
    setBusy(true);
    setErr(null);
    const body = {
      name: name.trim(),
      design: own ? { face: design.face, colour: design.colour, below: design.below, intro: design.intro, font: design.font, size: design.size } : {},
      items: items.map((b) => ({ kind: b.kind, value: b.value.trim(), label: b.label.trim() })),
      mandatory_items: must.map((b) => ({ kind: b.kind, value: b.value.trim(), label: b.label.trim() })),
    };
    try {
      const d = initial ? await api.updateDepartment(ws.id, initial.id, body) : await api.createDepartment(ws.id, body);
      onSaved(d);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const lockNote = ws.brand.lock_design
    ? ws.brand.lock_allows_departments
      ? t("company.lockNoteAllowed")
      : t("company.lockNoteBlocked")
    : t("company.lockNoteFree");

  return (
    <section className="panel card" aria-label={initial ? t("company.editDept", { name: initial.name }) : t("company.newDept")}>
      <div className="head"><h2>{initial ? t("company.editDept", { name: initial.name }) : t("company.newDept")}</h2></div>
      <label>
        {t("company.deptName")}
        <input dir="auto" value={name} maxLength={MAX_DEPARTMENT_NAME} onChange={(e) => setName(e.target.value)} aria-invalid={tried && !!nameErr} placeholder={t("company.deptNamePh")} />
        {tried && nameErr && <span className="err" role="alert">{nameErr}</span>}
      </label>

      <div className="pane">
        <div className="sechead">{t("company.startButtons")}</div>
        <p className="hint">{t("company.startHint")}</p>
        <ButtonListEditor items={items} onChange={setItems} addLabel={t("company.addStarting")} empty={t("company.startEmpty")} idPrefix="start" />
        {tried && itemsErr && <span className="err" role="alert">{itemsErr}</span>}
      </div>

      <div className="pane">
        <div className="sechead">{t("company.requiredButtons")}</div>
        <p className="hint">{t("company.deptRequiredHint")}</p>
        <ButtonListEditor items={must} onChange={setMust} addLabel={t("company.addRequired")} empty={t("company.deptRequiredEmpty")} idPrefix="must" />
        {tried && mustErr && <span className="err" role="alert">{mustErr}</span>}
      </div>

      <div className="pane">
        <ToggleRow first title={t("company.ownDesignToggle")} hint={t("company.ownDesignHint")} checked={own} onChange={setOwn} />
        {own && (
          <>
            <div className="notice"><div className="grow">{lockNote}</div></div>
            <div className={s.wizardBox}><DesignTab ed={ed} /></div>
          </>
        )}
      </div>

      {err !== null && err !== undefined && (err instanceof ApiError ? <div className="notice bad" role="alert"><div className="grow"><b>{t("company.deptNotSaved")}</b>{problemOf(err, t)}</div></div> : <ErrorBox error={err} />)}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? t("common.saving") : initial ? t("company.saveDept") : t("company.createDept")}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
      </div>
    </section>
  );
}
