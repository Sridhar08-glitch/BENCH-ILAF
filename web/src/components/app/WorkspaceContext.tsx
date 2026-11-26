"use client";

// Who is signed in and which workspace (personal or one of their companies) they are working in.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isClosedForDeletion, isSuspendedCompany } from "@/lib/api";
import { hasFeature } from "@/lib/enterprise";
import { useWorkspaces, useMe, useWorkspaceDetail } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import { Loading, ErrorBox } from "./ui";
import type { EnterpriseFeature, Role, User, WorkspaceSummary } from "@/lib/types";

interface Ctx {
  user: User;
  workspaces: WorkspaceSummary[];
  current: WorkspaceSummary;
  setCurrent: (id: string) => void;
  role: Role;
  /** Owner or admin: can manage the whole workspace. */
  isManager: boolean;
  isCompany: boolean;
  /** A company the person is not the owner of is waiting to be deleted: nothing in it can be opened. */
  closed: boolean;
  /** The day the company will be erased, when the owner is looking at a company that is scheduled for deletion. */
  closingDue: string | null;
  /** The product team suspended the company: nothing in it can be opened. */
  suspended: boolean;
  /** Whether the current company may use an Enterprise-only feature (the server decides; this only hides and locks the screens). */
  has: (feature: EnterpriseFeature) => boolean;
}

const WsContext = createContext<Ctx | null>(null);
const STORE = "bench.workspace";
// Value saved under the earlier key is still read once so nobody loses their selected workspace.
const OLD_STORE = "ilaf.workspace";

export function useWs(): Ctx {
  const c = useContext(WsContext);
  if (!c) throw new Error("useWs must be used inside WorkspaceProvider");
  return c;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const me = useMe();
  const wsq = useWorkspaces();
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPick(localStorage.getItem(STORE) ?? localStorage.getItem(OLD_STORE));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setCurrent = useCallback((id: string) => {
    setPick(id);
    try {
      localStorage.setItem(STORE, id);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const list = wsq.data;
  const current = useMemo(() => {
    if (!list || list.length === 0) return null;
    return list.find((w) => w.id === pick) ?? list.find((w) => w.kind === "personal") ?? list[0];
  }, [list, pick]);

  // The company's own record tells whether it is closed: a non-owner is refused (403 workspace_pending_deletion),
  // the owner gets the deletion date.
  const detail = useWorkspaceDetail(current?.kind === "company" ? current.id : "");

  if (me.isLoading || wsq.isLoading) return <Loading full label={t("dash.wsLoading")} />;
  if (me.error || wsq.error || !me.data || !list || !current) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorBox error={me.error || wsq.error} onRetry={() => { void me.refetch(); void wsq.refetch(); }} />
      </div>
    );
  }
  const value: Ctx = {
    user: me.data,
    workspaces: list,
    current,
    setCurrent,
    role: current.role,
    isManager: current.role === "owner" || current.role === "admin",
    isCompany: current.kind === "company",
    closed: current.kind === "company" && isClosedForDeletion(detail.error),
    suspended: current.kind === "company" && isSuspendedCompany(detail.error),
    closingDue: current.role === "owner" && current.kind === "company" ? (detail.data?.deletion_due_at ?? null) : null,
    has: (feature) => hasFeature(current.subscription, feature),
  };
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}
