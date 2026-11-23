"use client";

// The chat button in the bottom corner. It is tiny on purpose: the chat itself (ChatPanel) is downloaded only when the
// person opens it, and nothing talks to the server until then.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { OPEN_CHAT_EVENT } from "@/lib/support/events";
import s from "./support.module.css";

const ChatPanel = dynamic(() => import("./ChatPanel"), { ssr: false });

/** `workspaceId`: the company the person is working in, so its chat switch (feature flag) is the one the server applies. */
export function ChatLauncher({ workspaceId }: { workspaceId?: string }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [join, setJoin] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setJoin((e as CustomEvent<{ id?: string }>).detail?.id ?? null);
      setLoaded(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, []);

  function close() {
    setOpen(false);
    // give the focus back to the button that opened the chat
    window.setTimeout(() => button.current?.focus(), 0);
  }

  return (
    <>
      {loaded && <ChatPanel open={open} onClose={close} joinId={join} workspaceId={workspaceId} />}
      {!open && (
        <button ref={button} type="button" className={s.launcher} aria-haspopup="dialog" aria-expanded={false} onClick={() => { setLoaded(true); setOpen(true); }}>
          <Icon name="chat" size="s" />
          {t("support.chat.open")}
        </button>
      )}
    </>
  );
}
