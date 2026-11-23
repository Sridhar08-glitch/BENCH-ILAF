"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, PageHead, QrPreview, SkeletonBlocks, UpgradeNotice, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { EmptyState } from "@/components/guide/EmptyState";
import { GettingStarted } from "@/components/guide/GettingStarted";
import { TourButton } from "@/components/guide/TourButton";
import { announce } from "@/lib/guide/api";
import { BulkActionDialog } from "@/components/ops/BulkActionDialog";
import { Check, ResultsDialog, SelectionBar } from "@/components/ops/shared";
import { api, isUpgradeError } from "@/lib/api";
import { CARD_ACTIONS, allSelected, pruneSelection, selectAll, toggleId, type CardBulkAction } from "@/lib/ops/bulk";
import { PUBLIC_HOST } from "@/lib/config";
import { keys, useCards, usePlans, useWorkspaceDetail } from "@/lib/hooks";
import { VerifiedBadge } from "@/components/card/VerifiedBadge";
import { cardAllowance, cardListName, moveId } from "@/lib/card-order";
import { cardOrderApi } from "@/lib/security-api";
import { useI18n } from "@/lib/i18n/client";
import { tk } from "@/lib/i18n";
import type { BulkResult, Card } from "@/lib/types";

export default function CardsPage() {
  const { current, isManager, isCompany, user } = useWs();
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const cards = useCards(current.id);
  const [err, setErr] = useState<unknown>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<CardBulkAction | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulkErr, setBulkErr] = useState<unknown>(null);

  const create = useMutation({
    mutationFn: () => api.createCard(current.id, { name: user.full_name }),
    onSuccess: (c) => {
      // The answer carries what the API really saved: an employee under locked name or title rules gets the company's values, not the typed ones.
      qc.setQueryData(keys.card(c.id), c);
      void qc.invalidateQueries({ queryKey: keys.cards(current.id) });
      void qc.invalidateQueries({ queryKey: keys.workspaces });
      router.push(`/app/cards/${c.id}`);
    },
    onError: setErr,
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.duplicateCard(id),
    onSuccess: () => {
      toast(t("cards.duplicated"));
      void qc.invalidateQueries({ queryKey: keys.cards(current.id) });
      void qc.invalidateQueries({ queryKey: keys.workspaces });
    },
    onError: setErr,
  });
  const setPublished = useMutation({
    mutationFn: (v: { id: string; publish: boolean }) => (v.publish ? api.publishCard(v.id) : api.unpublishCard(v.id)),
    onSuccess: (_c, v) => {
      toast(v.publish ? t("cards.published") : t("cards.unpublished"));
      if (v.publish) announce("card_published");
      setErr(null);
      void qc.invalidateQueries({ queryKey: keys.cards(current.id) });
    },
    onError: setErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCard(id),
    onSuccess: () => {
      toast(t("cards.deleted"));
      void qc.invalidateQueries({ queryKey: keys.cards(current.id) });
      void qc.invalidateQueries({ queryKey: keys.workspaces });
    },
    onError: setErr,
  });

  const reorder = useMutation({
    mutationFn: (order: string[]) => cardOrderApi.reorder(current.id, order),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.cards(current.id) }),
    onError: setErr,
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => cardOrderApi.makeDefault(id),
    onSuccess: () => {
      toast(t("cardx.defaultSet"));
      void qc.invalidateQueries({ queryKey: keys.cards(current.id) });
    },
    onError: setErr,
  });
  const plans = usePlans();
  const detail = useWorkspaceDetail(isCompany ? current.id : "");
  const verified = isCompany ? detail.data?.verified_domain ?? null : null;

  const runBulk = useMutation({
    mutationFn: (v: { action: CardBulkAction; ids: string[] }) => api.bulkCards(current.id, v),
    onSuccess: (r) => {
      setBulk(null);
      setBulkErr(null);
      setBulkResult(r);
      setSelected([]);
      void qc.invalidateQueries({ queryKey: keys.cards(current.id) });
      void qc.invalidateQueries({ queryKey: keys.workspaces });
      void qc.invalidateQueries({ queryKey: ["audit", current.id] });
    },
    onError: setBulkErr,
  });

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("cards.linkCopied"));
    } catch {
      toast(t("cards.copyFailed"));
    }
  }

  const list = useMemo(() => cards.data ?? [], [cards.data]);
  const ids = useMemo(() => list.map((c) => c.id), [list]);
  useEffect(() => {
    setSelected((sel) => {
      const next = pruneSelection(sel, ids);
      return next.length === sel.length ? sel : next;
    });
  }, [ids]);
  const bulkDef = CARD_ACTIONS.find((a) => a.id === bulk);
  const canCreate = isManager || list.length === 0;
  // A person's own workspace: the plan says how many cards fit, and the cards can be put in order.
  const personal = !isCompany;
  const maxCards = personal ? plans.data?.find((p) => p.code === current.subscription.plan_code)?.max_cards : undefined;
  const allowance = cardAllowance(list.length, maxCards);
  const orderable = personal && list.length > 1;

  return (
    <div className="view">
      <PageHead title={isManager ? t("cards.title") : t("cards.titleMine")} sub={t("cards.sub")}>
        <TourButton />
        {canCreate && (
          <button type="button" className="btn" data-guide="cards-new" disabled={create.isPending} onClick={() => { setErr(null); create.mutate(); }}>
            <Icon name="plus" size="s" />{create.isPending ? t("cards.creating") : t("cards.newCard")}
          </button>
        )}
      </PageHead>

      {verified && <VerifiedBadge domain={verified} label={t("cardx.verified")} tip={t("cardx.verifiedTip", { domain: verified })} align="start" />}
      {personal && allowance.max !== null && list.length > 0 && (
        <div className={`notice ${allowance.canAdd ? "" : "warn"}`} role="status">
          <div className="grow">{allowance.canAdd ? t("cardx.allowance", { used: list.length, max: allowance.max }) : t("cardx.allowanceFull", { max: allowance.max })}</div>
          {!allowance.canAdd && <Link className="btn sm" href="/app/billing">{t("cardx.upgrade")}</Link>}
        </div>
      )}

      {isUpgradeError(err) ? <UpgradeNotice error={err} /> : err ? <ErrorBox error={err} /> : null}

      {/* An employee has no home page, so their checklist sits here. */}
      {!isManager && <GettingStarted />}

      {cards.isLoading ? (
        <SkeletonBlocks rows={3} />
      ) : cards.error ? (
        <ErrorBox error={cards.error} onRetry={() => void cards.refetch()} />
      ) : list.length === 0 ? (
        <div className="panel">
          <EmptyState title={t("cards.emptyTitle")} helpSlug="create-and-edit-your-card" action={canCreate ? <button type="button" className="btn sm" onClick={() => create.mutate()}>{t("cards.createFirst")}</button> : undefined}>
            {isManager ? t("cards.emptyManager") : t("cards.emptyMember")}
          </EmptyState>
        </div>
      ) : (
        <>
        {isManager && isCompany && (
          selected.length > 0 ? (
            <SelectionBar count={selected.length} onClear={() => setSelected([])}>
              {CARD_ACTIONS.map((a) => (
                <button key={a.id} type="button" className={`btn sm ghost ${a.danger ? "danger" : ""}`} onClick={() => { setBulkErr(null); setBulk(a.id); }}>{a.label}</button>
              ))}
            </SelectionBar>
          ) : (
            <label style={{ flexDirection: "row", alignItems: "center", gap: 10, fontWeight: 600, color: "var(--ink)" }}>
              <Check checked={allSelected(selected, ids)} label={t("cards.selectAll")} onChange={(on) => setSelected(selectAll(ids, on))} />
              {t("cards.selectHint")}
            </label>
          )
        )}
        <div className="strip" data-guide="cards-list">
          {list.map((c, at) => (
            <CardTile
              key={c.id}
              card={c}
              order={orderable ? { first: at === 0, last: at === list.length - 1, up: () => reorder.mutate(moveId(ids, c.id, -1)), down: () => reorder.mutate(moveId(ids, c.id, 1)), makeDefault: () => makeDefault.mutate(c.id) } : null}
              manager={isManager}
              selectable={isManager && isCompany}
              checked={selected.includes(c.id)}
              onCheck={() => setSelected((sel) => toggleId(sel, c.id))}
              busy={setPublished.isPending || duplicate.isPending}
              onCopy={() => void copyLink(c.public_url)}
              onPublish={(publish) => { setErr(null); setPublished.mutate({ id: c.id, publish }); }}
              onDuplicate={() => { setErr(null); duplicate.mutate(c.id); }}
              onDelete={() => { if (window.confirm(t("cards.confirmDelete", { name: c.name || t("cards.thisCard") }))) remove.mutate(c.id); }}
            />
          ))}
        </div>
        </>
      )}

      {bulk && bulkDef && (
        <BulkActionDialog
          kind="cards"
          action={bulk}
          actionLabel={bulkDef.label}
          count={selected.length}
          danger={bulkDef.danger}
          pending={runBulk.isPending}
          error={bulkErr}
          onCancel={() => setBulk(null)}
          onRun={() => runBulk.mutate({ action: bulk, ids: selected })}
        />
      )}
      {bulkResult && <ResultsDialog result={bulkResult} onClose={() => setBulkResult(null)} />}
    </div>
  );
}

const CARD_STATUS = {
  published: { t: tk("cards.statusPublished"), c: "ok" },
  suspended: { t: tk("cards.statusSuspended"), c: "bad" },
  draft: { t: tk("cards.statusDraft"), c: "" },
} as const;

function CardTile({ card, order, manager, selectable, checked, onCheck, busy, onCopy, onPublish, onDuplicate, onDelete }: {
  card: Card;
  /** Set for a person with several cards: move up or down, and make this the default card. */
  order: { first: boolean; last: boolean; up: () => void; down: () => void; makeDefault: () => void } | null;
  manager: boolean;
  selectable: boolean;
  checked: boolean;
  onCheck: () => void;
  busy: boolean;
  onCopy: () => void;
  onPublish: (publish: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const status = CARD_STATUS[card.status === "published" ? "published" : card.status === "suspended" ? "suspended" : "draft"];
  const name = card.name || t("cards.thisCard");
  return (
    <div className="panel card" style={{ gap: 12 }}>
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        {selectable && <Check checked={checked} onChange={onCheck} label={t("cards.selectName", { name })} />}
        <span className="mq" style={{ width: 64, height: 64 }}><QrPreview text={card.public_url} label={t("dash.uiQrFor", { text: card.name })} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b dir="auto" style={{ display: "block", overflowWrap: "anywhere" }}>{card.label ? cardListName(card, t("cards.untitled")) : card.name || t("cards.untitled")}</b>
          <small className="mono ltr">{PUBLIC_HOST}/{card.slug ?? card.public_code}</small>
          <div className="row" style={{ marginBlockStart: 6 }}>
            <span className={`pill ${status.c}`}>{t(status.t)}</span>
            {card.owner && <span className="pill" dir="auto">{card.owner.full_name}</span>}
            {order && card.is_default && <span className="pill dark">{t("cardx.default")}</span>}
          </div>
        </div>
      </div>
      <div className="row" style={{ color: "var(--mute)", fontSize: 12 }}>
        <span>{t("cards.nViews", { n: card.stats.views })}</span>
        <span>{t("cards.nSaves", { n: card.stats.saves })}</span>
        <span>{t("cards.nContacts", { n: card.stats.leads })}</span>
      </div>
      <div className="row" data-guide="cards-actions">
        <Link className="btn sm" href={`/app/cards/${card.id}`}>{t("cards.edit")}</Link>
        <Link className="btn ghost sm" href={`/app/qr?card=${card.id}`}>QR</Link>
        {card.status === "published" && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => onPublish(false)}>{t("cards.unpublish")}</button>}
        {card.status === "draft" && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => onPublish(true)}>{t("cards.publish")}</button>}
        <button type="button" className="btn ghost sm" onClick={onCopy} aria-label={t("cards.copyLinkFor", { name })}><Icon name="copy" size="s" />{t("cards.copyLink")}</button>
        {manager && <button type="button" className="btn ghost sm" disabled={busy} onClick={onDuplicate}>{t("cards.duplicate")}</button>}
        {order && !card.is_default && <button type="button" className="btn ghost sm" onClick={order.makeDefault}>{t("cardx.makeDefault")}</button>}
        {order && !order.first && <button type="button" className="btn ghost sm" aria-label={t("cardx.moveUp", { name })} onClick={order.up}><Icon name="chev" size="s" style={{ transform: "rotate(-90deg)" }} /></button>}
        {order && !order.last && <button type="button" className="btn ghost sm" aria-label={t("cardx.moveDown", { name })} onClick={order.down}><Icon name="chev" size="s" style={{ transform: "rotate(90deg)" }} /></button>}
        {manager && <button type="button" className="btn danger sm" onClick={onDelete}>{t("common.delete")}</button>}
      </div>
    </div>
  );
}
