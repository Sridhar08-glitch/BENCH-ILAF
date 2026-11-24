"use client";

// The feature switches the product team controls (backend: staff/flags.py). The customer app asks for them once a minute at
// most; while the answer is unknown, or when it fails, every switch is ON so nothing disappears by accident.
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/designs/api";

export const FLAG_KEYS = ["directory", "api_keys", "crm_connectors", "wallet_google", "custom_designs", "support_chat", "pack2_faces"] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];
export type Flags = Record<FlagKey, boolean>;

export const FLAG_DEFAULTS: Flags = { directory: true, api_keys: true, crm_connectors: true, wallet_google: true, custom_designs: true, support_chat: true, pack2_faces: true };

/** The answer of the server laid over the defaults; unknown keys are ignored and anything that is not a boolean keeps its default. */
export function mergeFlags(answer: Record<string, unknown> | null | undefined): Flags {
  const out = { ...FLAG_DEFAULTS };
  if (!answer) return out;
  for (const key of FLAG_KEYS) if (typeof answer[key] === "boolean") out[key] = answer[key] as boolean;
  return out;
}

export function useFlags(workspaceId?: string): Flags {
  const q = useQuery({
    queryKey: ["flags", workspaceId ?? ""],
    queryFn: () => call<{ flags: Record<string, unknown> }>("flags", { query: { workspace: workspaceId } }),
    staleTime: 60_000, retry: false, refetchOnWindowFocus: false,
  });
  return mergeFlags(q.data?.flags);
}
