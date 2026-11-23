"use client";

// The private preview of a custom design: the face on four sample employees of the company, in the four colourways.
// No sign-in. Approving happens in the company's dashboard.
import Link from "next/link";
import { useState } from "react";
import { FaceStage, STAGE_PEOPLE } from "./shared";
import type { PreviewPayload } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export function PreviewPage({ data }: { data: PreviewPayload }) {
  const { t, date } = useI18n();
  const [colour, setColour] = useState(0);
  const people = data.people && data.people.length
    ? data.people.map((p, i) => ({ ...p, ar: /[؀-ۿ]/.test(p.name), id: String(i) }))
    : STAGE_PEOPLE;
  const four = [0, 1, 2, 3].map((i) => people[i % people.length]);
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px 40px" }}>
      <div role="note" style={{ background: "var(--ink)", color: "#fff", padding: "10px 16px", margin: "0 -16px 20px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <b>{t("designs.previewBanner")}</b>
        <span style={{ color: "var(--inv-mute)" }}>{data.company.name} · {data.face.name}</span>
        <span className="grow" />
        {data.expires_at && <span style={{ color: "var(--inv-mute)" }}>{t("designs.previewExpires", { date: date(data.expires_at) })}</span>}
      </div>
      <p className="sub" style={{ marginBottom: 14 }}>{t("designs.previewLead")}</p>
      <div className="row" role="group" aria-label={t("designs.colourways")} style={{ marginBottom: 14, flexWrap: "wrap" }}>
        {data.face.palettes.map((p, i) => (
          <button key={i} type="button" className={`btn sm ${i === colour ? "" : "ghost"}`} aria-pressed={i === colour} onClick={() => setColour(i)}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 6, background: p.bg, border: "1px solid var(--line)", marginInlineEnd: 6 }} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="g2">
        {four.map((p, i) => (
          <FaceStage key={i} face={data.face} colour={colour} person={p} companyName={data.company.name} brandJson={data.company.brand} items={data.sample_items} />
        ))}
      </div>
      <p style={{ marginBlockStart: 22 }}><Link className="btn" href="/app/requests">{t("designs.previewApprove")}</Link></p>
    </main>
  );
}
