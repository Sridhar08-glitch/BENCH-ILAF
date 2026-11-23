"use client";

// Feature switches: off, on for chosen companies, or on for everyone (with a rollout percent). Everyone can look; only an admin edits.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa, type Flag } from "@/lib/staff-admin/api";
import { fmtWhen } from "@/lib/staff-admin/format";
import { Await, Page, Pill, ReasonDialog, RoleButton, toneOf } from "./ui";

const STATE_WORDS: Record<Flag["state"], string> = { off: "Off for everyone", selected: "On for chosen companies", everyone: "On" };

function FlagCard({ f }: { f: Flag }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [percent, setPercent] = useState(String(f.rollout_percent));
  const [companies, setCompanies] = useState(f.companies.map((c) => c.id).join(", "));
  const [dlg, setDlg] = useState<null | { state: Flag["state"] }>(null);
  const save = async (body: { state?: string; rollout_percent?: number; company_ids?: string[] }) => { await sa.setFlag(f.key, body); toast("Saved and logged"); await qc.invalidateQueries({ queryKey: ["staff-flags"] }); };
  return (
    <section className="panel" style={{ padding: 14, display: "grid", gap: 10 }} aria-label={f.key}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h2 style={{ fontSize: 16 }}>{f.key}</h2><span className="hint">{f.description}</span></div>
        <Pill tone={toneOf(f.state)}>{STATE_WORDS[f.state]}{f.state === "everyone" && f.rollout_percent < 100 ? ` (${f.rollout_percent}%)` : ""}</Pill>
      </div>
      <div className="row">
        {(["everyone", "selected", "off"] as const).map((s) => (
          <RoleButton key={s} perm="flags" className={`btn sm ${f.state === s ? "" : "ghost"}`} disabled={f.state === s} onClick={() => setDlg({ state: s })}>{s === "everyone" ? "On" : s === "selected" ? "Chosen companies" : "Off"}</RoleButton>
        ))}
      </div>
      <div className="row">
        <label className="row">Rollout <input type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} style={{ width: 80 }} /> % of companies</label>
        <RoleButton perm="flags" className="btn sm ghost" onClick={() => void save({ rollout_percent: Number(percent) }).catch(() => toast("Enter a whole number from 0 to 100"))}>Save rollout</RoleButton>
      </div>
      <div className="row">
        <label className="row">Chosen companies (ids) <input value={companies} onChange={(e) => setCompanies(e.target.value)} placeholder="id, id" style={{ minWidth: 260 }} /></label>
        <RoleButton perm="flags" className="btn sm ghost" onClick={() => void save({ company_ids: companies.split(",").map((x) => x.trim()).filter(Boolean) })}>Save companies</RoleButton>
      </div>
      {f.companies.length > 0 && <span className="hint">Chosen: {f.companies.map((c) => c.name).join(", ")}</span>}
      {f.history.length > 0 && (
        <details><summary>History ({f.history.length})</summary>
          {f.history.map((h, i) => <div key={i} className="hint">{fmtWhen(h.at)} - {h.who}: {h.text}</div>)}
        </details>
      )}
      {dlg && <ReasonDialog title={`${f.key}: ${STATE_WORDS[dlg.state]}`} text="The customer app asks for switches about once a minute, so the change shows within a minute." confirm="Change" minLength={0} danger={dlg.state === "off"} onClose={() => setDlg(null)} onConfirm={() => save({ state: dlg.state })} />}
    </section>
  );
}

export default function Flags() {
  const q = useQuery({ queryKey: ["staff-flags"], queryFn: sa.flags });
  return (
    <Page title="Feature switches" sub="Turn a feature off or on, for everyone or for chosen companies. Everything that exists today is on.">
      <Await q={q}>
        {(d) => (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>{d.flags.map((f) => <FlagCard key={f.key} f={f} />)}</div>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 6 }}><h2 style={{ fontSize: 16 }}>Recent changes</h2>
              {d.history.length === 0 && <span className="hint">No changes yet.</span>}
              {d.history.map((h, i) => <div key={i} className="row" style={{ justifyContent: "space-between" }}><span><b>{h.who}</b> {h.text}</span><span className="hint">{fmtWhen(h.at)}</span></div>)}
            </section>
          </>
        )}
      </Await>
    </Page>
  );
}
