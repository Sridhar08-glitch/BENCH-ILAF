"use client";

// A follow-up request: changes to a custom design that is already live, linked to that design.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RequestForm } from "@/components/designs/RequestForm";
import { PageHead } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { useI18n } from "@/lib/i18n/client";

function Follow() {
  const { current } = useWs();
  const { t } = useI18n();
  const face = Number(useSearchParams().get("face")) || null;
  return (
    <div className="view">
      <PageHead title={t("designs.changesToThis")} sub={t("designs.followSub")} />
      <RequestForm wsId={current.id} followsFace={face} />
    </div>
  );
}

export default function FollowPage() {
  return <Suspense><Follow /></Suspense>;
}
