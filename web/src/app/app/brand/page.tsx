"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { DesignTab } from "@/components/editor/DesignTab";
import type { EditorApi } from "@/components/editor/types";
import { ToggleRow } from "@/components/app/Switch";
import { CountrySelect } from "@/components/app/CountrySelect";
import { PreviewDock } from "@/components/app/PreviewDock";
import { TourButton } from "@/components/guide/TourButton";
import { announce } from "@/lib/guide/api";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { DomainPanel } from "@/components/brand/DomainPanel";
import { ColoursPanel, LogoFilesPanel, LogoLookPanel, LookPanel, type Update } from "@/components/brand/BrandPanels";
import s from "@/components/brand/brand.module.css";
import { ApiError, api, isUpgradeError } from "@/lib/api";
import { useBrandInfo } from "@/lib/brand-info-client";
import { brandProblem } from "@/lib/brand/errors";
import { countryName } from "@/lib/countries";
import { PEOPLE, SAMPLE_ITEMS, brandCardData, personById } from "@/lib/brand/sample";
import { brandPatch, fullBrand, type FullBrand } from "@/lib/brand/state";
import { backStep, goTo, isDone, isFirst, isLast, nextLabel, nextStep, shouldWarnOnLeave, startFlow, stepsFor, summaryRows, type StepId } from "@/lib/brand/steps";
import { useI18n } from "@/lib/i18n/client";
import { clearDraft } from "@/lib/preview-bridge";
import { keys, keys as hooksKeys, useWorkspaceDetail } from "@/lib/hooks";
import { presetOf, presetRules, ruleChanges, type RightsPreset } from "@/lib/ops/fields";
import { ExtrasRule } from "@/components/ops/ExtrasRule";
import { tk, type MessageKey } from "@/lib/i18n";
import { toCompanyBrand } from "@/lib/library/company/brand";
import type { ArtworkMode, Card, Design, FieldRules, WorkspaceDetail } from "@/lib/types";

export default function BrandPage() {
  const { current } = useWs();
  const ws = useWorkspaceDetail(current.id);
  if (ws.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (ws.error) return <div className="view"><ErrorBox error={ws.error} onRetry={() => void ws.refetch()} /></div>;
  if (!ws.data) return null;
  return <BrandFlow key={ws.data.id} ws={ws.data} />;
}

function BrandFlow({ ws }: { ws: WorkspaceDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const { t, number, locale } = useI18n();
  const company = ws.kind === "company";
  const steps = useMemo(() => stepsFor(company), [company]);
  const [flow, setFlow] = useState(startFlow);
  const [name, setName] = useState(ws.name);
  const [b, setB] = useState<FullBrand>(() => fullBrand(ws.brand));
  const [country, setCountry] = useState(ws.country ?? "");
  const [err, setErr] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  const [replay, setReplay] = useState(0);
  const [person, setPerson] = useState(PEOPLE[0].id);
  const [panel, setPanel] = useState<ArtworkMode | "custom">(b.artwork.mode);
  const top = useRef<HTMLDivElement>(null);

  const save = useMutation({
    mutationFn: () => api.updateWorkspace(ws.id, { name: name.trim(), brand: brandPatch(b, company), ...(company ? { country: country || null } : {}) }),
    onSuccess: (w) => {
      qc.setQueryData(keys.workspace(ws.id), w);
      void qc.invalidateQueries({ queryKey: keys.workspaces });
      setB(fullBrand(w.brand));
      setCountry(w.country ?? "");
      setDirty(false);
      setErr(null);
      announce("brand_saved");
    },
    onError: (e) => setErr(e instanceof ApiError ? e : new ApiError(0, "error", t("brand.saveFailed"))),
  });
  const saving = save.isPending;

  // Closing the tab, or following any link inside the app, with changes that were not saved asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (shouldWarnOnLeave(dirty, saving)) e.preventDefault();
    };
    const guard = (e: MouseEvent) => {
      if (!shouldWarnOnLeave(dirty, saving) || e.defaultPrevented) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm(t("brand.leaveConfirm"))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [dirty, saving, t]);

  useEffect(() => () => clearDraft("brand"), []);

  const update: Update = (fn, d = true) => {
    setB(fn);
    if (d) setDirty(true);
  };
  const change = (patch: Partial<FullBrand>) => update((x) => ({ ...x, ...patch }));

  const brandName = b.company_name || ws.name;
  const companyBrand = useMemo(() => (company ? toCompanyBrand({ ...b, company_name: brandName }) : null), [b, brandName, company]);
  const measured = useBrandInfo(companyBrand);
  const preview = useMemo(() => brandCardData(b, brandName, person, companyBrand, locale), [b, brandName, person, companyBrand, locale]);

  // The design editor is the same one cards use, pointed at the company design.
  const who = personById(person);
  const sampleCard = useMemo<Card>(
    () => ({
      id: "brand", workspace_id: ws.id, owner: null, public_code: "sample", public_url: "", slug: null, status: "draft",
      name: who.name, title: who.title, company: brandName, address: "", photo_url: null,
      save_contact: true, vc: { company: true, photo: true, phones: true, emails: true, urls: true, social: true, addr: true, note: "" },
      design: b.design, items: SAMPLE_ITEMS as Card["items"], created_at: "", updated_at: "", stats: { views: 0, scans: 0, saves: 0, leads: 0 },
    }),
    [b.design, brandName, ws.id, who],
  );
  const ed: EditorApi = {
    card: sampleCard,
    draft: { name: sampleCard.name, title: sampleCard.title, company: sampleCard.company, address: "", save_contact: true, vc: sampleCard.vc, design: b.design, items: sampleCard.items },
    update: (p) => p.design && change({ design: p.design as Design }),
    patchNow: () => undefined,
    locked: false,
    icons: [],
    setPhoto: () => undefined,
    setCover: () => undefined,
    canCover: false,
    brand: companyBrand,
    replay: () => setReplay((n) => n + 1),
  };
  const panels = { b, update, wsId: ws.id, toast };

  const step = steps[flow.index];
  const count = steps.length;
  const donePath = company ? "/app/team" : "/app/cards";

  async function saveNow(): Promise<boolean> {
    if (!dirty) return true;
    try {
      await save.mutateAsync();
      return true;
    } catch {
      return false;
    }
  }

  function show(i: number) {
    setFlow((f) => goTo(f, i, count));
    top.current?.scrollIntoView({ block: "start" });
  }

  async function onNext() {
    if (!(await saveNow())) return;
    if (isLast(flow, count)) {
      toast(t("brand.toastSaved"));
      router.push(donePath);
      return;
    }
    setFlow((f) => nextStep(f, count));
    top.current?.scrollIntoView({ block: "start" });
  }

  const status = saving ? t("common.saving") : dirty ? t("brand.statusDirty") : t("common.saved");
  const statusClass = saving ? "warn" : dirty ? "warn" : "ok";

  return (
    <div className="split">
      <div className="formcol" ref={top} style={{ scrollMarginBlockStart: "calc(var(--topbar-h) + 14px)" }}>
        <div className="top">
          <div>
            <h1>{t("brand.title")}</h1>
            <p className="sub">{t("brand.subtitle")}</p>
          </div>
          <div className="row">
            <TourButton />
            <span className={`pill ${statusClass} saved`} role="status" aria-live="polite">
              <Icon name={saving || dirty ? "clock" : "check"} size="s" />{status}
            </span>
          </div>
        </div>

        <nav aria-label={t("brand.stepsLabel")} data-guide="brand-steps">
          <ol className={s.stepper}>
            {steps.map((st, i) => {
              const done = isDone(flow, i);
              return (
                <li key={st.id} className={s.stepitem}>
                  <button type="button" className={`${s.stepbtn} ${done ? s.stepdone : ""}`} aria-current={i === flow.index ? "step" : undefined} onClick={() => show(i)}>
                    <span className={s.stepdot}>{done ? <Icon name="check" size="s" /> : number(i + 1)}</span>
                    <span className={s.steplab}>{t(st.title)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {isUpgradeError(err) ? <ErrorBox error={err} /> : err ? (
          <div className="notice bad" role="alert">
            <Icon name="alert" />
            <div className="grow"><b>{t("brand.saveErrorTitle")}</b>{brandProblem(err, t)}</div>
          </div>
        ) : null}

        <section className="panel card" aria-labelledby="step-title" data-guide="brand-body">
          <div className={s.stephead}>
            <span className="eyebrow">{t("brand.stepOf", { n: number(flow.index + 1), total: number(count) })}</span>
            <h2 id="step-title" className={s.steptitle}>{t(step.title)}</h2>
            <p className="sub">{t(step.hint)}</p>
          </div>
          <StepBody
            id={step.id} company={company} name={name} setName={(v) => { setName(v); setDirty(true); }} country={country} setCountry={(v) => { setCountry(v); setDirty(true); }}
            b={b} change={change} panels={panels} measured={measured} panel={panel} setPanel={setPanel} ed={ed} update={update} workspaceName={ws.name} donePath={donePath} wsId={ws.id}
          />
        </section>

        <div className={s.nav} data-guide="brand-next">
          <button type="button" className="btn ghost" disabled={isFirst(flow) || saving} onClick={() => { setFlow((f) => backStep(f, count)); top.current?.scrollIntoView({ block: "start" }); }}>{t("common.back")}</button>
          <span className="hint">{dirty ? t("brand.hintDirty") : t("brand.hintClean")}</span>
          <button type="button" className="btn" disabled={saving} onClick={() => void onNext()}>
            {saving ? t("common.saving") : nextLabel(flow, count, t)}{!saving && !isLast(flow, count) && <Icon name="arrow" size="s" />}
          </button>
        </div>
      </div>

      <PreviewDock
        data={preview}
        shareKey="brand"
        href="/app/preview/brand"
        playKey={replay}
        onReplay={() => setReplay((n) => n + 1)}
        top={
          <div className={s.people} role="group" aria-label={t("brand.sampleEmployee")}>
            {PEOPLE.map((p) => (
              <button key={p.id} type="button" aria-pressed={person === p.id} onClick={() => setPerson(p.id)}>{p.labelKey ? t(p.labelKey) : p.label}</button>
            ))}
          </div>
        }
        hint={t("brand.previewHint")}
        lift
      />
    </div>
  );
}

interface BodyProps {
  id: StepId;
  company: boolean;
  name: string;
  setName: (v: string) => void;
  country: string;
  setCountry: (v: string) => void;
  b: FullBrand;
  change: (patch: Partial<FullBrand>) => void;
  update: Update;
  panels: { b: FullBrand; update: Update; wsId: string; toast: (m: string) => void };
  measured: ReturnType<typeof useBrandInfo>;
  panel: ArtworkMode | "custom";
  setPanel: (p: ArtworkMode | "custom") => void;
  ed: EditorApi;
  workspaceName: string;
  donePath: string;
  wsId: string;
}

/** The controls of one step. Only the step on screen is drawn. */
function StepBody({ id, company, name, setName, country, setCountry, b, change, update, panels, measured, panel, setPanel, ed, workspaceName, donePath, wsId }: BodyProps) {
  const { t, number, locale } = useI18n();
  const { has } = useWs();
  if (id === "style") {
    return (
      <div className="pane">
        {company && b.artwork.mode === "template" && (
          <div className="notice" role="status">
            <Icon name="alert" />
            <div className="grow">{t("brand.templateNotice")}</div>
          </div>
        )}
        <DesignTab ed={ed} />
      </div>
    );
  }
  if (id === "company") {
    return (
      <div className="pane">
        {company ? <CountrySelect value={country} onChange={setCountry} /> : null}
        <label>{t("brand.companyNameOnCards")}<input dir="auto" value={b.company_name} onChange={(e) => change({ company_name: e.target.value })} /></label>
        <div className={s.sub}>
          <h3>{t("brand.logoAndSymbol")}</h3>
          <LogoFilesPanel {...panels} simple={!company} />
        </div>
        {company && (
          <div className={s.sub}>
            <h3>{t("brand.detailsColours")}</h3>
            <ColoursPanel {...panels} />
          </div>
        )}
      </div>
    );
  }
  if (id === "logo") return <LogoLookPanel b={b} update={update} />;
  if (id === "team") return <TeamStep wsId={wsId} />;
  return (
    <div className="pane">
      <details className={s.more} open>
        <summary>{t("brand.moreCompany")}</summary>
        <div className="pane">
          <label>{t("brand.workspaceName")}<input dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>{t("brand.website")}<input className="ltr" value={b.website} placeholder="company.com" onChange={(e) => change({ website: e.target.value })} /></label>
          {company && <DomainPanel wsId={wsId} allowed={has("custom_domain")} />}
        </div>
      </details>
      {company && (
        <details className={s.more}>
          <summary>{t("brand.moreArtwork")}</summary>
          <LookPanel {...panels} measured={measured} panel={panel} setPanel={setPanel} />
        </details>
      )}
      <details className={s.more}>
        <summary>{t("brand.moreLock")}</summary>
        <div>
          <ToggleRow first title={t("brand.lockDesign")} hint={t("brand.lockDesignHint")} checked={b.lock_design} onChange={(v) => change({ lock_design: v })} />
          {company && b.lock_design && (
            <ToggleRow title={t("brand.lockDepts")} hint={t("brand.lockDeptsHint")} checked={!!b.lock_allows_departments} onChange={(v) => change({ lock_allows_departments: v })} />
          )}
          <ToggleRow title={t("brand.poweredBy")} checked={b.show_footer} onChange={(v) => change({ show_footer: v })} />
        </div>
      </details>
      <details className={s.more}>
        <summary>{t("brand.moreSummary")}</summary>
        <dl className={s.summary}>
          {summaryRows(b, workspaceName, company, { t, number }, countryName(country, locale)).map((r) => (
            <div key={r.label}><dt>{r.label}</dt><dd dir="auto">{r.value}</dd></div>
          ))}
        </dl>
      </details>
      <div className="notice" role="status">
        <Icon name="users" />
        <div className="grow">
          <b>{t("brand.nextInviteTitle")}</b>
          {t("brand.nextInviteText")}
          {company && <div style={{ marginBlockStart: 8 }}><Link className="btn ghost sm" href={donePath}>{t("brand.goToTeam")}</Link></div>}
        </div>
      </div>
    </div>
  );
}

/** How much people can change on their own cards, as one choice. The rules are saved at once (they are not part of the brand's Save). */
function TeamStep({ wsId }: { wsId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: hooksKeys.fieldRules(wsId), queryFn: () => api.fieldRules(wsId) });
  const save = useMutation({
    mutationFn: (p: RightsPreset) => api.updateFieldRules(wsId, ruleChanges(q.data as FieldRules, presetRules(p, q.data as FieldRules))),
    onSuccess: (r) => {
      qc.setQueryData(hooksKeys.fieldRules(wsId), r);
      toast(t("brand.rightsSaved"));
    },
    onError: () => toast(t("brand.rightsFailed")),
  });
  if (q.isLoading) return <SkeletonBlocks rows={2} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const now = presetOf(q.data);
  const options: [RightsPreset, MessageKey, MessageKey][] = [
    ["free", tk("brand.rightsFree"), tk("brand.rightsFreeHint")],
    ["approval", tk("brand.rightsApproval"), tk("brand.rightsApprovalHint")],
    ["locked", tk("brand.rightsLocked"), tk("brand.rightsLockedHint")],
  ];
  return (
    <div className="pane">
      <h3>{t("brand.rightsTitle")}</h3>
      <div role="radiogroup" aria-label={t("brand.rightsTitle")} className={s.rights}>
        {options.map(([v, title, hint]) => (
          <button key={v} type="button" role="radio" aria-checked={now === v} className={`${s.right} ${now === v ? s.rightOn : ""}`} disabled={save.isPending} onClick={() => now !== v && save.mutate(v)}>
            <b>{t(title)}</b>
            <small>{t(hint)}</small>
          </button>
        ))}
      </div>
      {now === null && <div className={s.note} role="status"><b>{t("brand.rightsCustom")}</b> {t("brand.rightsCustomHint")}</div>}
      <p className="hint">{t("brand.rightsNote")}</p>
      <ExtrasRule wsId={wsId} />
      <div className="row">
        <Link className="btn" href="/app/team">{t("brand.rightsInvite")}</Link>
        <Link className="btn ghost" href="/app/fields">{t("brand.rightsPerField")}</Link>
      </div>
    </div>
  );
}
