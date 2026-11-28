import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  deletedFlyersQuery,
  usePurgeFlyer,
  useRestoreFlyer,
  type Flyer,
} from "@/features/flyers/api";
import { api } from "@/lib/api/client";
import { flyerKeys } from "@/features/flyers/api";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { useAuth } from "@/stores/auth";
import { formatDate, petDisplayName } from "@/lib/utils";

export function RecentlyDeletedPage() {
  const navigate = useNavigate();
  const { user, checked } = useAuth();
  const query = useQuery(deletedFlyersQuery());
  const qc = useQueryClient();

  useEffect(() => {
    if (checked && !user) {
      navigate("/auth/login", { replace: true });
    }
  }, [checked, user, navigate]);

  if (checked && !user) {
    return null;
  }

  const results: Flyer[] = query.data?.results ?? [];
  const singleSubject = results.length === 1 ? results[0]?.pet?.name : undefined;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{
    kind: "restore" | "purge";
    ids: string[];
    subject?: string;
  } | null>(null);

  const isAllSelected = results.length > 0 && selected.size === results.length;
  const toggleSelectAll = () =>
    setSelected(isAllSelected ? new Set() : new Set(results.map((flyer) => flyer.id)));

  const toggleSelection = (id: string) =>
    setSelected((current) => (current.has(id) ? removeId(current, id) : addId(current, id)));

  const bulkRestore = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => api.post<Flyer>(`/flyers/${id}/restore`).then((r) => r.data))),
    onSuccess: () => {
      setSelected(new Set());
      setDialog(null);
      void qc.invalidateQueries({ queryKey: flyerKeys.deleted });
      void qc.invalidateQueries({ queryKey: flyerKeys.mine });
      void qc.invalidateQueries({ queryKey: flyerKeys.all });
    },
  });

  const bulkPurge = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => api.delete(`/flyers/${id}/deleted`).then((r) => r.data))),
    onSuccess: () => {
      setSelected(new Set());
      setDialog(null);
      void qc.invalidateQueries({ queryKey: flyerKeys.deleted });
    },
  });

  const confirmDialog = () => {
    if (!dialog) return;
    const mutation = dialog.kind === "restore" ? bulkRestore : bulkPurge;
    void mutation.mutateAsync(dialog.ids);
  };

  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <h1 className="t-h1" data-enter>
            Recently Deleted
          </h1>
        </div>
        <p className="t-lead" data-enter="2" style={{ marginBottom: 24 }}>
          Flyers you deleted are kept here until you restore them to My Flyers or delete
          them permanently.
        </p>

        {query.isLoading && (
          <div className="deleted-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <DeletedFlyerRow key={i} flyer={{} as unknown as Flyer} skeleton />
            ))}
          </div>
        )}

        {query.isError && <ErrorBox message="Could not load your deleted flyers. Please try again." />}
        {!query.isLoading && !query.isError && results.length === 0 && (
          <EmptyState title="Recently Deleted is empty">
            <p style={{ marginBottom: 16 }}>
              Deleted flyers appear here. Restore a flyer to put it back on My Flyers,
              or delete it permanently.
            </p>
          </EmptyState>
        )}

        {results.length > 0 && (
          <>
            <div className="deleted-toolbar" role="toolbar" aria-label="Bulk actions">
              <span className="deleted-toolbar__count">{selected.size} selected</span>
              <input
                type="checkbox"
                id="deleted-select-all"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                aria-label={isAllSelected ? "Deselect all" : "Select all"}
                style={{ marginLeft: 12, marginRight: 8, width: 18, height: 18, flexShrink: 0 }}
              />
              <label htmlFor="deleted-select-all" style={{ fontSize: 14, color: "var(--color-muted)" }}>
                {isAllSelected ? "Deselect all" : "Select all"}
              </label>
              <Button
                variant="sage"
                disabled={selected.size === 0 || bulkRestore.isPending}
                onClick={() =>
                  setDialog({
                    kind: "restore",
                    ids: [...selected],
                    subject: singleSubject,
                  })
                }
              >
                {bulkRestore.isPending ? "Restoring…" : "Restore selected"}
              </Button>
              <Button
                variant="emergency"
                disabled={selected.size === 0 || bulkPurge.isPending}
                onClick={() => setDialog({ kind: "purge", ids: [...selected] })}
              >
                {bulkPurge.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
            <div className="deleted-grid">
              {results.map((flyer) => (
                <DeletedFlyerRow
                  key={flyer.id}
                  flyer={flyer}
                  selected={selected.has(flyer.id)}
                  onToggle={() => toggleSelection(flyer.id)}
                  onRestore={() =>
                    setDialog({ kind: "restore", ids: [flyer.id], subject: flyer.pet.name })
                  }
                  onPurge={() => setDialog({ kind: "purge", ids: [flyer.id] })}
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
                ? `The selected flyer${dialog.ids.length > 1 ? "s" : ""} will be restored to My Flyers.`
                : `The selected flyer${dialog.ids.length > 1 ? "s" : ""} will be permanently deleted — the photo, QR code and public link will stop working.`
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

function DeletedFlyerRow({
  flyer,
  selected = false,
  onToggle,
  onRestore,
  onPurge,
  skeleton = false,
}: {
  flyer: Flyer;
  selected?: boolean;
  onToggle?: () => void;
  onRestore?: () => void;
  onPurge?: () => void;
  skeleton?: boolean;
}) {
  const restoreFlyer = useRestoreFlyer(flyer.id);
  const purgeFlyer = usePurgeFlyer(flyer.id);
  const pet = flyer.pet ?? null;
  const displayName = pet ? petDisplayName(pet, flyer.mode) : "Pet";
  const deleted = flyer.deleted_at ? formatDate(flyer.deleted_at) : "";
  const emergency = flyer.mode === "emergency";
  const found = flyer.mode === "found";
  const accent = emergency
    ? "var(--color-emergency-deep)"
    : found
    ? "var(--color-found-deep)"
    : "var(--color-sage-deep)";

  return (
    <div className="card deleted-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
      {onToggle && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${displayName} flyer`}
          style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }}
        />
      )}
      <div style={{ width: 72, height: 72, borderRadius: 12, overflow: "hidden", background: "var(--color-surface)", flexShrink: 0 }}>
        {skeleton ? (
          <Skeleton style={{ width: "100%", height: "100%" }} />
        ) : (
          <img
            src={flyer.photo_url || "/pet-fallback.webp"}
            alt={flyer.photo_url ? displayName : ""}
            loading="lazy"
            aria-hidden={!flyer.photo_url ? true : undefined}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <ModeBadge mode={flyer.mode} />
          {flyer.status && <StatusBadge status={flyer.status} />}
        </div>
        <h3 className="t-h3" style={{ margin: 0, color: accent, fontSize: 18 }}>
          {displayName}
        </h3>
        {deleted && (
          <p className="t-small" style={{ margin: 0, color: "var(--color-muted)" }}>
            Deleted {deleted}
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
        <Button
          variant="sage"
          disabled={restoreFlyer.isPending || Boolean(onRestore === undefined)}
          onClick={onRestore}
        >
          {restoreFlyer.isPending ? "Restoring…" : "Restore"}
        </Button>
        <Button
          variant="emergency"
          disabled={purgeFlyer.isPending || Boolean(onPurge === undefined)}
          onClick={onPurge}
        >
          {purgeFlyer.isPending ? "Deleting…" : "Delete permanently"}
        </Button>
      </div>
    </div>
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
