import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Calendar, MapPin, Pencil } from "lucide-react";
import { useAuth } from "@/stores/auth";
import type { Flyer } from "@/features/flyers/api";
import { isFlyerEditable, isFlyerOwner } from "@/features/flyers/edit-helpers";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { formatDate, petDisplayName } from "@/lib/utils";

export function FlyerCard({ flyer }: { flyer: Flyer }) {
  const emergency = flyer.mode === "emergency";
  const found = flyer.mode === "found";
  const accent = emergency
    ? "var(--color-emergency-deep)"
    : found
    ? "var(--color-found-deep)"
    : "var(--color-sage-deep)";
  const modeColor = emergency
    ? "var(--color-emergency)"
    : found
    ? "var(--color-found)"
    : "var(--color-sage)";

  const displayName = petDisplayName(flyer.pet, flyer.mode);
  const user = useAuth((s) => s.user);
  const canEdit = isFlyerOwner(flyer, user) && isFlyerEditable(flyer);
  const [photoFailed, setPhotoFailed] = useState(false);
  const hasPhoto = Boolean(flyer.photo_url) && !photoFailed;

  return (
    <article
      className="card flyer-card"
      style={{ borderTop: `3px solid ${modeColor}` }}
    >
      <Link
        to={`/flyers/${flyer.id}`}
        className="flyer-card__link"
        aria-label={`View ${displayName} flyer`}
      >
        <div className="photo-frame flyer-card__photo">
          <img
            src={hasPhoto ? flyer.photo_url : "/pet-fallback.webp"}
            alt={hasPhoto ? displayName : ""}
            loading="lazy"
            aria-hidden={!hasPhoto ? true : undefined}
            onError={() => setPhotoFailed(true)}
          />
        </div>

        <div style={{ padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <ModeBadge mode={flyer.mode} />
            <StatusBadge status={flyer.status} />
          </div>

          <h3
            className="t-h3"
            style={{
              color: accent,
              margin: 0,
              fontSize: "clamp(19px, 2.2vw, 22px)",
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.01em",
            }}
          >
            {displayName}
          </h3>

          <p className="t-small" style={{ margin: 0, color: "var(--color-muted)", lineHeight: 1.45 }}>
            {[flyer.pet.species, flyer.pet.breed || "mixed", flyer.pet.color || "—"].join(" · ")}
            {flyer.last_seen_location && emergency ? ` · last seen ${flyer.last_seen_location}` : ""}
            {flyer.last_seen_location && found ? ` · found at ${flyer.last_seen_location}` : ""}
          </p>

          {flyer.last_seen_location && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                color: "var(--color-muted)",
                fontSize: 13,
              }}
            >
              <MapPin size={13} style={{ color: modeColor, flexShrink: 0, marginTop: 2 }} />
              <span style={{ overflowWrap: "anywhere" }}>
                {emergency ? "Last seen " : found ? "Found at " : ""}{flyer.last_seen_location}
              </span>
            </div>
          )}

          {flyer.last_seen_date && (emergency || found) && (
            <p
              className="t-label"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "var(--color-muted)",
                margin: 0,
              }}
            >
              <Calendar size={12} style={{ flexShrink: 0 }} />
              <span>{emergency ? "Last seen" : "Found"} {formatDate(flyer.last_seen_date)}</span>
            </p>
          )}

          <div
            style={{
              marginTop: "auto",
              paddingTop: 12,
              borderTop: "1px solid var(--color-line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 13,
              fontWeight: 600,
              color: accent,
            }}
          >
            <span>View flyer</span>
            <span className="flyer-card__arrow" aria-hidden="true">
              <ArrowRight size={14} />
            </span>
          </div>
        </div>
      </Link>

      {canEdit && (
        <Link
          to={`/flyers/${flyer.id}/edit`}
          className="btn btn--secondary btn--icon flyer-card__edit no-print"
          aria-label={`Edit ${displayName} flyer`}
          title="Edit flyer"
        >
          <Pencil size={18} aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}
