import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { CalendarDays, RotateCcw, Trash2 } from "lucide-react";
import {
  deletedFlyersQuery,
  flyerKeys,
  purgeDeletedFlyer,
  restoreDeletedFlyer,
  type Flyer,
} from "@/features/flyers/api";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { useAuth } from "@/stores/auth";
import { formatDate, petDisplayName } from "@/lib/utils";

type PendingAction = {
  kind: "restore" | "purge";
  ids: string[];
  subject?: string;
};

export function RecentlyDeletedPage() {
  const navigate = useNavigate();
  const { user, checked } = useAuth();
  const query = useQuery(deletedFlyersQuery());
  const qc = useQueryClient();
  // Every hook stays above the auth redirect guard — the hook order must never
  // change while the auth store is still resolving the current session.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (checked && !user) {
      navigate("/auth/login", { replace: true });
    }
  }, [checked, user, navigate]);

  const bulkRestore = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(restoreDeletedFlyer)),
    onSuccess: () => {
      setSelected(new Set());
      setDialog(null);
      setActionError(null);
      void qc.invalidateQueries({ queryKey: flyerKeys.deleted });
      void qc.invalidateQueries({ queryKey: flyerKeys.mine });
      void qc.invalidateQueries({ queryKey: flyerKeys.all });
    },
    onError: () => {
      setDialog(null);
      setActionError("Could not restore the selected flyers. Please try again.");
    },
  });

  const bulkPurge = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(purgeDeletedFlyer)),
    onSuccess: () => {
      setSelected(new Set());
      setDialog(null);
      setActionError(null);
      void qc.invalidateQueries({ queryKey: flyerKeys.deleted });
    },
    onError: () => {
      setDialog(null);
      setActionError("Could not permanently delete the selected flyers. Please try again.");
    },
  });

  if (checked && !user) {
    return null;
  }

  const results: Flyer[] = query.data?.results ?? [];
  const isAllSelected = results.length > 0 && selected.size === results.length;

  const subjectForIds = (ids: string[]): string | undefined => {
    if (ids.length !== 1) return undefined;
    const flyer = results.find((item) => item.id === ids[0]);
    return flyer?.pet ? petDisplayName(flyer.pet, flyer.mode) : undefined;
  };

  const openDialog = (kind: PendingAction["kind"], ids: string[]) => {
    setActionError(null);
    setDialog({ kind, ids, subject: subjectForIds(ids) });
  };

  const toggleSelectAll = () =>
    setSelected(isAllSelected ? new Set() : new Set(results.map((flyer) => flyer.id)));

  const toggleSelection = (id: string) =>
    setSelected((current) => (current.has(id) ? removeId(current, id) : addId(current, id)));

  const confirmDialog = () => {
    if (!dialog) return;
    const mutation = dialog.kind === "restore" ? bulkRestore : bulkPurge;
    void mutation.mutateAsync(dialog.ids);
  };

  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <div className="deleted-heading" data-enter>
            <p className="t-label deleted-heading__eyebrow">My flyers</p>
            <h1 className="t-h1">Recently Deleted</h1>
          </div>
          <Button asChild variant="secondary" data-enter="2">
            <Link to="/my-flyers">Back to My flyers</Link>
          </Button>
        </div>
        <p className="t-lead deleted-intro" data-enter="2">
          Flyers you deleted are kept here until you restore them to My Flyers or delete
          them permanently.
        </p>

        {query.isLoading && (
          <div className="deleted-grid" aria-label="Loading deleted flyers">
            {Array.from({ length: 3 }).map((_, i) => (
              <DeletedFlyerSkeleton key={i} />
            ))}
          </div>
        )}

        {query.isError && (
          <ErrorBox message="Could not load your deleted flyers. Please try again.">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </ErrorBox>
        )}

        {!query.isLoading && !query.isError && results.length === 0 && (
          <EmptyState title="Recently Deleted is empty">
            <p className="deleted-empty__copy">
              Deleted flyers appear here. Restore a flyer to put it back on My Flyers,
              or delete it permanently.
            </p>
            <Button asChild>
              <Link to="/my-flyers">Go to My flyers</Link>
            </Button>
          </EmptyState>
        )}

        {actionError && (
          <div className="deleted-action-error">
            <ErrorBox message={actionError}>
              <Button variant="secondary" onClick={() => setActionError(null)}>
                Dismiss
              </Button>
            </ErrorBox>
          </div>
        )}

        {results.length > 0 && (
          <>
            <div className="deleted-toolbar" role="toolbar" aria-label="Bulk actions for deleted flyers">
              <div className="deleted-toolbar__status">
                <span className="deleted-toolbar__count" aria-live="polite">
                  {selected.size > 0
                    ? `${selected.size} of ${results.length} selected`
                    : `${results.length} ${results.length === 1 ? "flyer" : "flyers"}`}
                </span>
                <label className="pp-check-label deleted-select-all">
                  <input
                    type="checkbox"
                    className="pp-checkbox__input"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    aria-label={isAllSelected ? "Deselect all deleted flyers" : "Select all deleted flyers"}
                  />
                  <span className="pp-checkbox__box" aria-hidden="true" />
                  <span>{isAllSelected ? "Deselect all" : "Select all"}</span>
                </label>
              </div>
              <div className="deleted-toolbar__actions">
                <Button
                  variant="sage"
                  disabled={selected.size === 0 || bulkRestore.isPending || bulkPurge.isPending}
                  onClick={() => openDialog("restore", [...selected])}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  {bulkRestore.isPending ? "Restoring…" : "Restore selected"}
                </Button>
                <Button
                  variant="emergency"
                  disabled={selected.size === 0 || bulkPurge.isPending || bulkRestore.isPending}
                  onClick={() => openDialog("purge", [...selected])}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {bulkPurge.isPending ? "Deleting…" : "Delete permanently"}
                </Button>
              </div>
            </div>

            <div className="deleted-grid">
              {results.map((flyer) => (
                <DeletedFlyerCard
                  key={flyer.id}
                  flyer={flyer}
                  selected={selected.has(flyer.id)}
                  busy={bulkRestore.isPending || bulkPurge.isPending}
                  onToggle={() => toggleSelection(flyer.id)}
                  onRestore={() => openDialog("restore", [flyer.id])}
                  onPurge={() => openDialog("purge", [flyer.id])}
                />
              ))}
            </div>
          </>
        )}

        {dialog && (
          <ConfirmDeleteDialog
            open
            onClose={() => setDialog(null)}
            confirming={dialog.kind === "restore" ? bulkRestore.isPending : bulkPurge.isPending}
            title={
              dialog.kind === "restore"
                ? dialog.ids.length === 1
                  ? "Restore this flyer?"
                  : `Restore ${dialog.ids.length} flyers?`
                : dialog.ids.length === 1
                  ? "Delete this flyer permanently?"
                  : `Delete ${dialog.ids.length} flyers permanently?`
            }
            body={
              dialog.kind === "restore"
                ? dialog.subject
                  ? <><strong style={{ color: "var(--color-ink)" }}>{dialog.subject}</strong> will be restored to My Flyers.</>
                  : `The selected flyers will be restored to My Flyers.`
                : dialog.subject
                  ? <><strong style={{ color: "var(--color-ink)" }}>{dialog.subject}</strong> and its photo, QR code and public link will be permanently deleted.</>
                  : `The selected flyers will be permanently deleted — their photos, QR codes and public links will stop working.`
            }
            subject={dialog.subject}
            confirmLabel={
              dialog.kind === "restore"
                ? dialog.ids.length === 1
                  ? "Restore flyer"
                  : "Restore all"
                : "Delete permanently"
            }
            cancelLabel="Keep in Recently Deleted"
            confirmVariant={dialog.kind === "restore" ? "sage" : "emergency"}
            onConfirm={confirmDialog}
          />
        )}
      </div>
    </section>
  );
}

function DeletedFlyerCard({
  flyer,
  selected = false,
  busy = false,
  onToggle,
  onRestore,
  onPurge,
}: {
  flyer: Flyer;
  selected?: boolean;
  busy?: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const pet = flyer.pet ?? null;
  const displayName = pet ? petDisplayName(pet, flyer.mode) : "Pet";
  const deleted = flyer.deleted_at ? formatDate(flyer.deleted_at) : "";
  const details = pet
    ? [pet.species, pet.breed || "mixed", pet.color || "—"].join(" · ")
    : "";

  return (
    <article
      className={`card deleted-card${selected ? " deleted-card--selected" : ""}`}
      data-mode={flyer.mode ?? "outreach"}
      data-selected={selected}
      aria-label={`${displayName} — deleted flyer`}
    >
      <div className="photo-frame deleted-card__photo">
        <img
          src={flyer.photo_url || "/pet-fallback.webp"}
          alt={flyer.photo_url ? displayName : ""}
          loading="lazy"
          aria-hidden={!flyer.photo_url ? true : undefined}
        />
        <label className="pp-check-label deleted-card__select">
          <input
            type="checkbox"
            className="pp-checkbox__input"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${displayName} flyer for bulk actions`}
          />
          <span className="pp-checkbox__box" aria-hidden="true" />
        </label>
      </div>

      <div className="deleted-card__body">
        <div className="deleted-card__badges">
          <ModeBadge mode={flyer.mode ?? undefined} />
          {flyer.status && <StatusBadge status={flyer.status} />}
        </div>
        <h3 className="t-h3 deleted-card__title">{displayName}</h3>
        {details && <p className="t-small deleted-card__meta">{details}</p>}
        {deleted && (
          <p className="deleted-card__date">
            <CalendarDays size={14} aria-hidden="true" />
            Deleted {deleted}
          </p>
        )}
      </div>

      <div className="deleted-card__actions no-print">
        <Button variant="sage" disabled={busy} onClick={onRestore}>
          <RotateCcw size={16} aria-hidden="true" />
          Restore
        </Button>
        <Button variant="emergency" disabled={busy} onClick={onPurge}>
          <Trash2 size={16} aria-hidden="true" />
          Delete permanently
        </Button>
      </div>
    </article>
  );
}

function DeletedFlyerSkeleton() {
  return (
    <article className="card deleted-card deleted-card--skeleton" aria-hidden="true">
      <div className="deleted-card__photo">
        <Skeleton style={{ width: "100%", height: "100%" }} />
      </div>
      <div className="deleted-card__body">
        <div className="deleted-card__badges">
          <Skeleton style={{ width: 64, height: 26, borderRadius: 999 }} />
          <Skeleton style={{ width: 72, height: 26, borderRadius: 999 }} />
        </div>
        <Skeleton style={{ width: "56%", height: 22 }} />
        <Skeleton style={{ width: "78%", height: 14 }} />
        <Skeleton style={{ width: "64%", height: 14 }} />
      </div>
      <div className="deleted-card__actions">
        <Skeleton style={{ width: "100%", height: 44, borderRadius: 999 }} />
        <Skeleton style={{ width: "100%", height: 44, borderRadius: 999 }} />
      </div>
    </article>
  );
}

function addId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  next.add(id);
  return next;
}

function removeId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  next.delete(id);
  return next;
}
