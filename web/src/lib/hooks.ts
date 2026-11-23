"use client";

// Data hooks: one place that knows which API call feeds which screen.
import { useQuery } from "@tanstack/react-query";
import { api, type AuditQuery } from "./api";
import type { ChangeStatus } from "./types";

export const keys = {
  me: ["me"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (ws: string) => ["workspace", ws] as const,
  cards: (ws: string) => ["cards", ws] as const,
  card: (id: string) => ["card", id] as const,
  leads: (ws: string, p: object) => ["leads", ws, p] as const,
  analytics: (ws: string, days: number, card?: string) => ["analytics", ws, days, card ?? ""] as const,
  members: (ws: string) => ["members", ws] as const,
  plans: ["plans"] as const,
  invoices: (ws: string) => ["invoices", ws] as const,
  subscription: (ws: string) => ["subscription", ws] as const,
  departments: (ws: string) => ["departments", ws] as const,
  audit: (ws: string, q: object) => ["audit", ws, q] as const,
  fieldRules: (ws: string) => ["field-rules", ws] as const,
  changes: (ws: string, status: string) => ["changes", ws, status] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });
export const useWorkspaces = () => useQuery({ queryKey: keys.workspaces, queryFn: api.workspaces });
export const useWorkspaceDetail = (ws: string) => useQuery({ queryKey: keys.workspace(ws), queryFn: () => api.workspace(ws), enabled: !!ws });
export const useCards = (ws: string) => useQuery({ queryKey: keys.cards(ws), queryFn: () => api.cards(ws), enabled: !!ws });
export const useCard = (id: string) => useQuery({ queryKey: keys.card(id), queryFn: () => api.card(id), enabled: !!id });
export const usePlans = () => useQuery({ queryKey: keys.plans, queryFn: api.plans, staleTime: 5 * 60_000 });
export const useInvoices = (ws: string) => useQuery({ queryKey: keys.invoices(ws), queryFn: () => api.invoices(ws), enabled: !!ws });
export const useMembers = (ws: string, enabled = true) => useQuery({ queryKey: keys.members(ws), queryFn: () => api.members(ws), enabled: !!ws && enabled });
export const useAnalytics = (ws: string, days: number, card?: string) =>
  useQuery({ queryKey: keys.analytics(ws, days, card), queryFn: () => api.analytics(ws, days, card), enabled: !!ws });
export const useLeads = (ws: string, p: { card_id?: string; q?: string; status?: string; limit?: number; offset?: number }) =>
  useQuery({ queryKey: keys.leads(ws, p), queryFn: () => api.leads(ws, p), enabled: !!ws });
export const useDepartments = (ws: string, enabled = true) =>
  useQuery({ queryKey: keys.departments(ws), queryFn: () => api.departments(ws), enabled: !!ws && enabled });
export const useAudit = (ws: string, q: AuditQuery) => useQuery({ queryKey: keys.audit(ws, q), queryFn: () => api.audit(ws, q), enabled: !!ws, placeholderData: (p) => p });
export const useFieldRules = (ws: string, enabled = true) =>
  useQuery({ queryKey: keys.fieldRules(ws), queryFn: () => api.fieldRules(ws), enabled: !!ws && enabled });
export const useChangeRequests = (ws: string, status: ChangeStatus | "all" = "pending", enabled = true) =>
  useQuery({ queryKey: keys.changes(ws, status), queryFn: () => api.changeRequests(ws, status), enabled: !!ws && enabled });
