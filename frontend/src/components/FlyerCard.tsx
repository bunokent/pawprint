import { Link } from "react-router";
import type { Flyer } from "@/features/flyers/api";
import { ModeBadge, RewardBadge, StatusBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export function FlyerCard({ flyer }: { flyer: Flyer }) {
  const emergency = flyer.mode === "emergency";
  const found = flyer.mode === "found";
  const accent = emergency ? "var(--color-emergency-deep)" : found ? "var(--color-terracotta-deep)" : "var(--color-sage-deep)";
  return (
    <Link
      to={`/flyers/${flyer.id}`}
      className="card card--link"
      style={{ display: "flex", flexDirection: "column", textDecoration: "none", color: "inherit" }}
    >
      <div className="photo-frame" style={{ aspectRatio: "4 / 3", background: "var(--color-surface)" }}>
        {flyer.photo_url ? (
          <img src={flyer.photo_url} alt={flyer.pet.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--color-muted)" }}>
            No photo yet
          </div>
        )}
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <ModeBadge mode={flyer.mode} />
          {flyer.reward_enabled && (flyer.reward_amount_cents ?? 0) > 0 && (
            <RewardBadge amount={flyer.reward_amount_cents ?? 0} currency={flyer.reward_currency ?? "PHP"} />
          )}
          <StatusBadge status={flyer.status} />
        </div>
        <h3 className="t-h3" style={{ color: accent }}>
          {flyer.pet.name}
        </h3>
        <p className="t-small" style={{ color: "var(--color-muted)" }}>
          {flyer.pet.species} · {flyer.pet.breed || "mixed"} · {flyer.pet.color || "—"}
          {flyer.last_seen_location && emergency ? ` · last seen ${flyer.last_seen_location}` : ""}
          {flyer.last_seen_location && found ? ` · found at ${flyer.last_seen_location}` : ""}
        </p>
        {flyer.last_seen_date && (emergency || found) && (
          <p className="t-label">{emergency ? "Last seen" : "Found"} {formatDate(flyer.last_seen_date)}</p>
        )}
      </div>
    </Link>
  );
}
