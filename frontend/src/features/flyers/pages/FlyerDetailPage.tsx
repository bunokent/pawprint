import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, MapPin, Trash2 } from "lucide-react";
import { flyerDetailQuery, exportFlyer, useDeleteFlyer, useUpdateFlyer } from "@/features/flyers/api";
import { isFlyerOwner } from "@/features/flyers/edit-helpers";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { ErrorBox, Skeleton } from "@/components/ui/feedback";
import { PhotoGallery } from "@/components/PhotoGallery";
import { ShareMenu } from "@/components/ShareMenu";
import { Avatar } from "@/components/Avatar";
import { formatDate, petDisplayName } from "@/lib/utils";

export function FlyerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const query = useQuery(flyerDetailQuery(id ?? ""));
  const updateFlyer = useUpdateFlyer(id ?? "");
  const deleteFlyer = useDeleteFlyer(id ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // "Mark reunited / returned home" is a life-changing state change — it requires a
  // deliberate second click (armed for 4 s) instead of resolving on a single tap.
  const [resolveArmed, setResolveArmed] = useState(false);
  const resolveTimer = useRef<number | null>(null);
  // Whether the download design-chooser dialog is open.
  const [downloadOpen, setDownloadOpen] = useState(false);
  // Which single design the user has selected to generate/download.
  const [selectedDesign, setSelectedDesign] = useState<string>("classic");
  // Whether a generation/download is in flight.
  const [generating, setGenerating] = useState(false);

  const flyer = query.data;
  const qrTarget = flyer?.qr_target_value ?? "";

  const downloadSelectedDesign = async () => {
    if (!flyer) return;
    setGenerating(true);
    try {
      const { data } = await exportFlyer(flyer.id, selectedDesign);
      const url = URL.createObjectURL(data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flyer-${flyer.id}-${selectedDesign}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
      setDownloadOpen(false);
    }
  };

  useEffect(
    () => () => {
      if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
    },
    [],
  );

  const armOrResolve = () => {
    if (resolveArmed) {
      if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
      void updateFlyer.mutateAsync({ status: "resolved" });
      return;
    }
    setResolveArmed(true);
    resolveTimer.current = window.setTimeout(() => setResolveArmed(false), 4000);
  };

  if (query.isLoading) {
    return (
      <section className="page-section">
        <div className="wrap split-2">
          <Skeleton className="flyer-photo" style={{ aspectRatio: "5 / 4" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton style={{ height: 40, width: "70%" }} />
            <Skeleton style={{ height: 20, width: "50%" }} />
            <Skeleton style={{ height: 20, width: "80%" }} />
          </div>
        </div>
      </section>
    );
  }

  if (query.isError || !flyer) {
    return (
      <section className="page-section">
        <div className="wrap">
          <ErrorBox message="This flyer could not be loaded.">
            <p style={{ marginTop: 8 }}>
              <Link to="/flyers" style={{ fontWeight: 600 }}>
                ← Back to all flyers
              </Link>
            </p>
          </ErrorBox>
        </div>
      </section>
    );
  }

  const emergency = flyer.mode === "emergency";
  const found = flyer.mode === "found";
  const isOwner = isFlyerOwner(flyer, user);
  const hasPin = flyer.location_lat != null && flyer.location_lng != null;
  const displayName = petDisplayName(flyer.pet, flyer.mode);
  const markLabel = emergency ? "Mark reunited" : found ? "Mark home" : "Mark adopted";
  const markFullLabel = emergency ? "Mark reunited" : found ? "Mark returned home" : "Mark adopted";
  const photoKind = emergency ? "lost pet" : found ? "found pet" : "adoptable pet";
  // One photo per pet; photo_urls is kept for legacy responses but only the cover is shown.
  const photoUrl = flyer.photo_url || flyer.photo_urls?.[0] || "";
  const shareUrl = qrTarget || window.location.href;
  const shareTitle = `${emergency ? "Lost pet" : found ? "Found pet" : "Up for adoption"}${flyer.pet.name?.trim() ? `: ${flyer.pet.name}` : ""}`;
  const shareText = `${shareTitle} — ${flyer.pet.species}${flyer.last_seen_location ? ` · ${flyer.last_seen_location}` : ""}. See the PawPrint flyer:`;

  return (
    <section className="page-section">
      <div className="wrap">
        {deleteFlyer.isError && <div style={{ marginBottom: 16 }}><ErrorBox message="Could not delete the flyer. Please try again." /></div>}

        {/* One large photo, one clear column of facts. The A4 download keeps the same hierarchy. */}
        <article className="card flyer-sheet detail-card" data-mode={flyer.mode} data-testid="flyer-sheet">
          <div className="flyer-sheet__grid">
            <div className="flyer-sheet__media">
              <PhotoGallery src={photoUrl} alt={`${displayName} — ${photoKind} photo`} />
              <div className="flyer-sheet__share no-print">
                <ShareMenu
                  iconOnly
                  info={{
                    url: shareUrl,
                    title: shareTitle,
                    text: shareText,
                    qrValue: qrTarget || shareUrl,
                    imageUrl: flyer.export_png_url || undefined,
                  }}
                />
              </div>
            </div>
            <div className="flyer-sheet__body">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <ModeBadge mode={flyer.mode} />
                <StatusBadge status={flyer.status} />
              </div>
              <h1 className="t-h1 flyer-sheet__title">
                {emergency ? "Lost pet" : found ? "Found pet" : "Up for adoption"}
                {flyer.pet.name?.trim() ? `: ${flyer.pet.name}` : ""}
              </h1>
              <p className="t-lead">
                {flyer.pet.species}
                {flyer.pet.breed ? ` · ${flyer.pet.breed}` : ""}
                {flyer.pet.color ? ` · ${flyer.pet.color}` : ""}
                {flyer.pet.age != null ? ` · ${flyer.pet.age} yr${flyer.pet.age === 1 ? "" : "s"}` : ""}
              </p>
              <div className="detail-actions no-print">
                  <Button variant="secondary" onClick={() => setDownloadOpen(true)}>
                    <Download size={16} /> Download PDF
                  </Button>
                  {hasPin && (
                    <Button variant="secondary" asChild>
                      <Link to="/map">
                        <MapPin size={16} /> View on map
                      </Link>
                    </Button>
                  )}
                </div>
              {(emergency || found) && flyer.last_seen_location && (
                <div>
                  <p className="t-label">{emergency ? "Last seen" : "Found at"}</p>
                  <p className="t-body" style={{ fontWeight: 600 }}>
                    {flyer.last_seen_location}
                    {flyer.last_seen_date ? ` — ${formatDate(flyer.last_seen_date)}` : ""}
                  </p>
                </div>
              )}
              {flyer.distinctive_markings && (
                <div>
                  <p className="t-label">{found ? "Description" : "Distinctive markings"}</p>
                  <p className="t-body">{flyer.distinctive_markings}</p>
                </div>
              )}
              {Array.isArray(flyer.pet.temperament_tags) && flyer.pet.temperament_tags.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(flyer.pet.temperament_tags as string[]).map((t) => (
                    <span key={t} className="badge badge--neutral">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--color-line)", paddingTop: 14, marginTop: 4 }}>
                <p className="t-label">{found ? "If this is your pet, contact" : "If found, contact"}</p>
                <p className="t-body" style={{ fontWeight: 600 }}>
                  {flyer.contact_phone || "—"}
                  {flyer.contact_email ? ` · ${flyer.contact_email}` : ""}
                </p>
                <div className="flyer-byline">
                  <Avatar
                    src={flyer.creator_avatar_url}
                    name={flyer.creator_display_name || "PawPrint member"}
                    size={38}
                    decorative
                  />
                  <p className="t-small" style={{ color: "var(--color-muted)" }}>
                    Posted by <strong>{flyer.creator_display_name || "a PawPrint member"}</strong>
                    <span className="flyer-byline__date">{formatDate(flyer.created_at)}</span>
                  </p>
                </div>
              </div>
              {isOwner && (
                <div className="detail-actions detail-actions--owner no-print">
                  {flyer.status === "active" && (
                    <Button
                      variant="sage"
                      aria-label={markFullLabel}
                      aria-live="polite"
                      disabled={updateFlyer.isPending}
                      onClick={armOrResolve}
                      onBlur={() => {
                        setResolveArmed(false);
                        if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
                      }}
                    >
                      {resolveArmed ? "Click again to confirm" : markLabel}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={deleteFlyer.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Trash2 size={16} /> Delete
                  </Button>
                </div>
              )}
            </div>
          </div>
        </article>
      </div>

      {isOwner && (
        <ConfirmDeleteDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          confirming={deleteFlyer.isPending}
          subject={flyer.pet.name?.trim() || undefined}
          onConfirm={() => {
            void deleteFlyer.mutateAsync().then(() => {
              setConfirmOpen(false);
              navigate("/my-flyers");
            });
          }}
        />
      )}
      <Modal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        title="Choose flyer design"
      >
        <p className="t-body" style={{ marginBottom: 16 }}>
          Select the design you want to download.
        </p>

        {generating ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 20 }}>
            <div
              style={{
                width: 32,
                height: 32,
                border: "3px solid var(--color-line)",
                borderTopColor: "var(--color-accent)",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <p style={{ fontSize: 14, color: "var(--color-ink)", fontWeight: 600, margin: 0 }}>
              Preparing your flyer…
            </p>
            <style>{`
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "classic", label: "Classic", accent: "var(--color-accent)", desc: "Original layout with side detail cards" },
              { value: "modern", label: "Modern", accent: "#8f1d17", desc: "Hero tile with stacked details" },
              { value: "minimalist", label: "Minimalist", accent: "#1a1a1a", desc: "Clean whitespace, black ink on ivory" },
              { value: "vibrant", label: "Vibrant", accent: "#ef4444", desc: "Bold accent band with rounded shapes" },
            ].map((d) => (
              <button
                key={d.value}
                onClick={() => setSelectedDesign(d.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: 12,
                  border: "1px solid var(--color-line)",
                  borderRadius: 8,
                  background: "var(--color-ground)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  borderLeft: `4px solid ${selectedDesign === d.value ? d.accent : "transparent"}`,
                  opacity: selectedDesign === d.value ? 1 : 0.95,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--color-accent-light)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--color-ground)";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: `2px solid ${d.accent}`,
                      background: selectedDesign === d.value ? d.accent : "transparent",
                      color: selectedDesign === d.value ? "#fff" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {selectedDesign === d.value ? "✓" : ""}
                  </div>
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "var(--color-ink)",
                        fontSize: 14,
                      }}
                    >
                      {d.label}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                      {d.desc}
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: 18, color: "var(--color-muted)" }}>→</span>
              </button>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <Button
                variant="secondary"
                onClick={() => setDownloadOpen(false)}
                disabled={generating}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={downloadSelectedDesign}
                disabled={generating}
              >
                {generating ? "Preparing…" : `Download ${selectedDesign.charAt(0).toUpperCase() + selectedDesign.slice(1)}`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
