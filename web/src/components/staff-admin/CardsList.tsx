"use client";

// Every card, newest first, without typing: thumbnail rows, status chips with counts and paging.
// The search text comes from the page's search box and narrows the same list.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorBox, SkeletonBlocks } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { CARD_CHIPS, cardPages, cardRange, cardTagWord, cardsQuery, chipText } from "@/lib/staff-admin/cards";
import styles from "./CardsList.module.css";
import { StaffCardThumb } from "./StaffCardThumb";
import { NoRows, Pill } from "./ui";

export default function CardsList({ term, onOpen }: { term: string; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [pageOf, setPageOf] = useState<{ key: string; page: number }>({ key: "", page: 1 });
  const key = `${term}|${status}`;
  const page = pageOf.key === key ? pageOf.page : 1;
  const q = useQuery({ queryKey: ["staff-cards", term, status, page], queryFn: () => sa.cards(cardsQuery({ q: term, status, page })), placeholderData: (prev) => prev });
  const data = q.data;
  const pages = data ? cardPages(data.count) : 1;

  return (
    <section style={{ display: "grid", gap: 10 }} aria-labelledby="cards-heading">
      <h2 id="cards-heading" style={{ fontSize: 16 }}>Cards</h2>
      <div className={styles.chips} role="group" aria-label="Filter cards by status">
        {CARD_CHIPS.map((c) => (
          <button key={c.key || "all"} type="button" className={`btn sm ${c.key === status ? "" : "ghost"}`} aria-pressed={c.key === status} onClick={() => setStatus(c.key)}>
            {chipText(c, data?.status_counts)}
          </button>
        ))}
      </div>

      {q.isLoading && <SkeletonBlocks rows={3} />}
      {!q.isLoading && (q.error || !data) && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {data && (data.results.length === 0
        ? <NoRows>{term || status ? "No card matches. Try fewer words or another status." : "No card has been made yet."}</NoRows>
        : (
          <>
            <ul className={`panel ${styles.list}`} aria-label="Cards">
              {data.results.map((c) => {
                const tag = cardTagWord(c.status, c.staff_hold, c.open_reports);
                return (
                  <li key={c.id}>
                    <button type="button" className={styles.row} onClick={() => onOpen(c.id)} aria-label={`Open card ${c.name || "(no name)"}`}>
                      <span className={styles.thumb}><StaffCardThumb card={c} width={84} /></span>
                      <span className={styles.body}>
                        <span className={styles.name}><b>{c.name || "(no name)"}</b><Pill tone={tag.tone}>{tag.text}</Pill></span>
                        <span className={styles.small}>{[c.title, c.workspace_name].filter(Boolean).join(" · ")}</span>
                        <span className={styles.mono}>{c.public_url.replace(/^https?:\/\//, "")}</span>
                        <span className={styles.small}>{c.owner ? `Owner: ${c.owner.full_name || c.owner.email}${c.owner.full_name ? ` · ${c.owner.email}` : ""}` : "No owner"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className={styles.foot}>
              <span className="hint" aria-live="polite">{cardRange(data.offset, data.results.length, data.count)}</span>
              <span className="row">
                <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => setPageOf({ key, page: page - 1 })}>Previous cards</button>
                <span className="hint">Page {Math.min(page, pages)} of {pages}</span>
                <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => setPageOf({ key, page: page + 1 })}>Next cards</button>
              </span>
            </div>
          </>
        ))}
    </section>
  );
}
