"use client";

// The event notes of this device as React state: saved in localStorage, sent to the leads API as soon as there is a connection.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApiErrorText } from "@/lib/i18n/use-api-error";
import {
  enqueue, isTransient, leadBody, loadEventName, loadNotes, makeNote, noteProblem, retryRejected, saveEventName, saveNotes, syncDue, waiting,
  type EventNote, type NoteInput, type NoteProblem, type SendResult,
} from "./notes";

const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const newRef = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export type AddResult = { ok: true; queued: boolean } | { ok: false; problem: NoteProblem | "duplicate" };

export function useEventNotes(workspaceId: string) {
  const qc = useQueryClient();
  const errText = useApiErrorText();
  const [list, setList] = useState<EventNote[]>([]);
  const [eventName, setEventNameState] = useState("");
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const latest = useRef<EventNote[]>([]);
  const busy = useRef(false);

  const commit = useCallback((next: EventNote[]) => {
    latest.current = next;
    setList(next);
    saveNotes(store(), next);
  }, []);

  useEffect(() => {
    const saved = loadNotes(store());
    latest.current = saved;
    setList(saved);
    setEventNameState(loadEventName(store()));
    setOnline(navigator.onLine);
  }, []);

  const sync = useCallback(async () => {
    if (busy.current || !navigator.onLine || waiting(latest.current).length === 0) return;
    busy.current = true;
    setSyncing(true);
    try {
      const send = async (n: EventNote): Promise<SendResult> => {
        try {
          await api.addLead(n.workspaceId, leadBody(n));
          return { ok: true };
        } catch (e) {
          const status = e instanceof ApiError ? e.status : null;
          return { ok: false, permanent: !isTransient(status), error: e instanceof ApiError ? errText(e) : "offline" };
        }
      };
      // Only this workspace's notes are sent; notes of another workspace wait until it is open. A note saved while sending is kept.
      const mineNow = latest.current.filter((n) => n.workspaceId === workspaceId);
      const before = waiting(mineNow).length;
      const done = new Map((await syncDue(mineNow, send, Date.now())).map((n) => [n.ref, n]));
      commit(latest.current.map((n) => done.get(n.ref) ?? n));
      if (waiting([...done.values()]).length < before) void qc.invalidateQueries({ queryKey: ["leads", workspaceId] });
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [commit, errText, qc, workspaceId]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void sync();
    // Retry now and then while notes wait (a retry is only made once its waiting time is over).
    const timer = window.setInterval(() => void sync(), 15000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [sync]);

  const add = useCallback(
    (input: Omit<NoteInput, "workspaceId" | "eventName">): AddResult => {
      const full: NoteInput = { ...input, workspaceId, eventName };
      const problem = noteProblem(full);
      if (problem) return { ok: false, problem };
      const { list: next, added } = enqueue(latest.current, makeNote(full, newRef(), Date.now()));
      if (!added) return { ok: false, problem: "duplicate" };
      commit(next);
      const queued = !navigator.onLine;
      void sync();
      return { ok: true, queued };
    },
    [commit, eventName, sync, workspaceId],
  );

  const setEventName = useCallback((name: string) => {
    setEventNameState(name);
    saveEventName(store(), name);
  }, []);

  const retry = useCallback(
    (ref: string) => {
      commit(retryRejected(latest.current, ref));
      void sync();
    },
    [commit, sync],
  );

  const mine = list.filter((n) => n.workspaceId === workspaceId);
  return { notes: mine, eventName, setEventName, online, syncing, waitingCount: waiting(mine).length, add, sync, retry };
}
