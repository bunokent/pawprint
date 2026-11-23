import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, MapPin } from "lucide-react";
import { flyerDetailQuery, useDeleteFlyer, useUpdateFlyer } from "@/features/flyers/api";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-dialog";
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

  const flyer = query.data;
  const qrTarget = flyer?.qr_target_value ?? "";

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
      <section style={{ padding: "64px 0" }}>
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
      <section style={{ padding: "64px 0" }}>
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
  const isOwner = Boolean(user && flyer.creator === user.id);
  const hasPin = flyer.location_lat != null && flyer.location_lng != null;
  const displayName = petDisplayName(flyer.pet, flyer.mode);
  const photoKind = emergency ? "lost pet" : found ? "found pet" : "adoptable pet";
  // One photo per pet; photo_urls is kept for legacy responses but only the cover is shown.
  const photoUrl = flyer.photo_url || flyer.photo_urls?.[0] || "";
  const shareUrl = qrTarget || window.location.href;
  const shareTitle = `${emergency ? "Lost pet" : found ? "Found pet" : "Up for adoption"}${flyer.pet.name?.trim() ? `: ${flyer.pet.name}` : ""}`;
  const shareText = `${shareTitle} — ${flyer.pet.species}${flyer.last_seen_location ? ` · ${flyer.last_seen_location}` : ""}. See the PawPrint flyer:`;

  return (
    <section style={{ padding: "48px 0 64px" }}>
      <div className="wrap">
        <div className="no-print btn-row" style={{ marginBottom: 24, flexWrap: "wrap" }}>
          <ShareMenu
            info={{
              url: shareUrl,
              title: shareTitle,
              text: shareText,
              qrValue: qrTarget || shareUrl,
              imageUrl: flyer.export_png_url || undefined,
            }}
          />
          {flyer.export_pdf_url && (
            <Button variant="secondary" style={{ height: 40 }} asChild>
              <a href={flyer.export_pdf_url} download>
                <Download size={16} /> Download PDF
              </a>
            </Button>
          )}
          {hasPin && (
            <Button variant="secondary" style={{ height: 40 }} asChild>
              <Link to="/map">
                <MapPin size={16} /> View on map
              </Link>
            </Button>
          )}
          {isOwner && flyer.status === "active" && (
            <Button
              variant="sage"
              style={{ height: 40 }}
              disabled={updateFlyer.isPending}
              aria-live="polite"
              onClick={armOrResolve}
              onBlur={() => {
                setResolveArmed(false);
                if (resolveTimer.current) window.clearTimeout(resolveTimer.current);
              }}
            >
              {resolveArmed
                ? "Click again to confirm"
                : emergency ? "Mark reunited" : found ? "Mark returned home" : "Mark adopted"}
            </Button>
          )}
          {isOwner && (
            <Button
              variant="secondary"
              style={{ height: 40 }}
              disabled={deleteFlyer.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              Delete flyer
            </Button>
          )}
        </div>

        {deleteFlyer.isError && <div style={{ marginBottom: 16 }}><ErrorBox message="Could not delete the flyer. Please try again." /></div>}

        {/* One large photo, one clear column of facts. The A4 download keeps the same hierarchy. */}
        <article className="card flyer-sheet" data-mode={flyer.mode} style={{ padding: 32 }} data-testid="flyer-sheet">
          <div className="flyer-sheet__grid">
            <div className="flyer-sheet__media">
              <PhotoGallery src={photoUrl} alt={`${displayName} — ${photoKind} photo`} />
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
    </section>
  );
}
