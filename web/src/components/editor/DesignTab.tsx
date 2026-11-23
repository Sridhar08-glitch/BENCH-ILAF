"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { useWs } from "@/components/app/WorkspaceContext";
import { useI18n } from "@/lib/i18n/client";
import { DesignWizard } from "./design/DesignWizard";
import type { EditorApi } from "./types";

/** The Design tab: the step-by-step picker, or only the company's message when the design is locked. */
export function DesignTab({ ed }: { ed: EditorApi }) {
  const { isManager } = useWs();
  const { t } = useI18n();

  if (ed.locked) {
    return (
      <div className="pane">
        <div className="notice warn" role="status">
          <Icon name="lock" />
          <div className="grow">
            <b>{t("editor.designLocked")}</b>
            {isManager ? (
              <>{t("editor.designLockedManager")} <Link href="/app/brand" style={{ fontWeight: 700 }}>{t("editor.designLockedBrand")}</Link></>
            ) : (
              t("editor.designLockedMember")
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <DesignWizard ed={ed} />
    </div>
  );
}
