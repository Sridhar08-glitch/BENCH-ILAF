"use client";

// The React side of the 429 wait kept in throttle.ts. It lives in its own client file so the server code that
// imports api.ts (the public card page) never pulls a React hook into the server graph.
import { useSyncExternalStore } from "react";
import { subscribeThrottle, throttleSnapshot } from "@/lib/throttle";

/** Seconds the person still has to wait before changes are accepted again (0 = none). Re-renders every second while counting. */
export function useThrottleWait(): number {
  return useSyncExternalStore(subscribeThrottle, throttleSnapshot, () => 0);
}
