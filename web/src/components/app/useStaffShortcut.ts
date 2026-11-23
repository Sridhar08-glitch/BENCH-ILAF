"use client";

import { useQuery } from "@tanstack/react-query";
import { staffApi } from "@/lib/designs/api";
import { staffShortcut, type StaffShortcut } from "@/lib/staff-admin/shortcut";

/** Asks once, in the background, whether the signed-in person has a staff role. Any failure simply means no shortcut. */
export function useStaffShortcut(): StaffShortcut | null {
  const q = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me, retry: false, staleTime: 10 * 60_000, refetchOnWindowFocus: false });
  return staffShortcut(q);
}
