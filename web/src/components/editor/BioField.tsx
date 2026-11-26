"use client";

// The short text about the person (300 characters) that the photo headers show under the name. It follows the company's
// address rule: free, locked, or sent to an admin for approval. It is not part of the draft, so it is saved on its own.
import { useState } from "react";
import { GuardedHint } from "./GuardedHint";
import { FREE_ACCESS, pendingFor } from "@/lib/ops/fields";
import { useI18n } from "@/lib/i18n/client";
import type { EditorApi } from "./types";

export const MAX_BIO = 300;

export function BioField({ ed }: { ed: EditorApi }) {
  const { t, number } = useI18n();
  const access = ed.access ?? FREE_ACCESS;
  const perm = access.bio ?? access.address;
  const [value, setValue] = useState(ed.card.bio ?? "");
  const [sent, setSent] = useState(false);
  const waiting = !!pendingFor(ed.pending, "bio") || sent;

  return (
    <div className="pane" style={{ gap: 6 }}>
      <label>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {t("editor.bio")}
          <span className="hint" style={{ marginInlineStart: "auto" }}>{t("content.counter", { n: number(value.length), max: number(MAX_BIO) })}</span>
        </span>
        <textarea
          dir="auto"
          rows={3}
          maxLength={MAX_BIO}
          value={value}
          readOnly={perm === "locked"}
          disabled={perm === "locked" || waiting}
          onChange={(e) => {
            setValue(e.target.value);
            setSent(false);
            // A free field saves as it is typed; an approval field waits for the button.
            if (perm === "free") ed.patchNow({ bio: e.target.value });
          }}
        />
        {perm === "free" && <span className="hint">{t("editor.bioHint", { max: number(MAX_BIO) })}</span>}
      </label>
      <GuardedHint perm={perm} waiting={waiting} />
      {perm === "approval" && !waiting && (
        <div>
          <button type="button" className="btn ghost sm" disabled={value.trim() === (ed.card.bio ?? "").trim()} onClick={() => { ed.patchNow({ bio: value.trim() }); setSent(true); }}>{t("editor.bioSend")}</button>
        </div>
      )}
    </div>
  );
}
