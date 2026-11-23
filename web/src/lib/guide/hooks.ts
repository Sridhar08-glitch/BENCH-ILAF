"use client";

// Data hooks of the guide: the saved progress, and the whole picture (context, audience, checklist) built from
// the queries the dashboard already makes. Nothing here has its own server data except the progress.
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWs } from "@/components/app/WorkspaceContext";
import { crm } from "@/lib/crm/api";
import { useCards, useDepartments, useFieldRules, useLeads, useMembers, useWorkspaceDetail } from "@/lib/hooks";
import { guideApi, type ProgressChange } from "./api";
import { buildContext } from "./context";
import { audienceFor, mergeProgress, stateOf, viewFor } from "./engine";
import type { Audience, GuideContext, GuideView, ProgressItem, ProgressState } from "./types";

export const guideKeys = { progress: ["guide-progress"] as const };

export function useGuideProgress() {
  return useQuery({ queryKey: guideKeys.progress, queryFn: guideApi.progress, staleTime: 60_000, retry: 1 });
}

/** Save changes at once in the cache (so the screen reacts) and send them; a failed save is put back by a refetch. */
export function useSaveChanges() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (changes: ProgressChange[]) => guideApi.save(changes),
    onMutate: (changes) => {
      qc.setQueryData<ProgressItem[]>(guideKeys.progress, (old) => (old ? changes.reduce((list, c) => mergeProgress(list, c), old) : old));
    },
    onError: () => void qc.invalidateQueries({ queryKey: guideKeys.progress }),
  });
  return { save: m.mutate, failed: m.isError };
}

/** One change: `save(guideId, stepId, state)`. */
export function useSaveProgress() {
  const { save } = useSaveChanges();
  return useCallback((guide_id: string, step_id: string, state: ProgressState | "reset") => save([{ guide_id, step_id, state }]), [save]);
}

export interface GuideState {
  loading: boolean;
  audience: Audience;
  ctx: GuideContext;
  view: GuideView;
  progress: ProgressItem[];
}

/** The checklist as it stands: context from live data, plus the saved marks. */
export function useGuideState(): GuideState {
  const { user, current, isManager, isCompany, role } = useWs();
  const progressQ = useGuideProgress();
  const progress = useMemo(() => progressQ.data ?? [], [progressQ.data]);
  const cards = useCards(current.id);
  const detail = useWorkspaceDetail(isCompany ? current.id : "");
  const members = useMembers(current.id, isCompany && isManager);
  const departments = useDepartments(current.id, isCompany && isManager);
  const rules = useFieldRules(current.id, isCompany);
  const leads = useLeads(current.id, { limit: 1 });
  const webhooks = useQuery({
    queryKey: ["guide-webhooks", current.id],
    queryFn: () => crm.webhooks(current.id),
    enabled: isCompany && isManager,
    retry: false,
    staleTime: 60_000,
  });

  const kind = current.kind;
  const audience = audienceFor({ kind, role }, progress);
  const ctx = useMemo(
    () =>
      buildContext({
        userId: user.id,
        kind,
        role,
        cards: cards.data,
        brand: detail.data?.brand ?? null,
        members: members.data,
        leadsCount: leads.data?.count ?? null,
        departmentsCount: departments.data?.length ?? null,
        webhooksCount: webhooks.data?.results.length ?? null,
        fieldRules: rules.data ?? null,
        progress,
      }),
    [user.id, kind, role, cards.data, detail.data, members.data, leads.data, departments.data, webhooks.data, rules.data, progress],
  );
  const view = useMemo(() => viewFor(audience, ctx, progress), [audience, ctx, progress]);
  return { loading: progressQ.isLoading || cards.isLoading, audience, ctx, view, progress };
}

/** Whether a saved row says "dismissed" or similar, for components that only need one fact. */
export function useSavedState(guide: string, step: string): ProgressState | null {
  const { data } = useGuideProgress();
  return data ? stateOf(data, guide, step) : null;
}
