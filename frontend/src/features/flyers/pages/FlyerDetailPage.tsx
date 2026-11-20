import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer, Download, Coins, MapPin } from "lucide-react";
import { flyerDetailQuery, useDeleteFlyer, useUpdateFlyer } from "@/features/flyers/api";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { ModeBadge, RewardBadge, StatusBadge } from "@/components/ui/badge";
import { ErrorBox, Skeleton } from "@/components/ui/feedback";
import { RewardCheckoutModal } from "@/features/rewards/components/RewardCheckoutModal";
import { QrImage } from "@/components/QrImage";
import { formatDate, formatMoney, petDisplayName } from "@/lib/utils";

export function FlyerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const query = useQuery(flyerDetailQuery(id ?? ""));
  const updateFlyer = useUpdateFlyer(id ?? "");
  const deleteFlyer = useDeleteFlyer(id ?? "");
  const [rewardOpen, setRewardOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const flyer = query.data;
  const qrTarget = flyer?.qr_target_value ?? "";

  if (query.isLoading) {
    return (
      <section style={{ padding: "64px 0" }}>
        <div className="wrap split-2">
          <Skeleton className="photo-frame" style={{ aspectRatio: "4 / 3", borderRadius: 20 }} />
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
  const accent = emergency ? "var(--color-emergency-deep)" : found ? "var(--color-found-deep)" : "var(--color-sage-deep)";
  const canReward = flyer.reward_enabled && (flyer.reward_amount_cents ?? 0) > 0;
  const hasPin = flyer.location_lat != null && flyer.location_lng != null;

  return (
    <section style={{ padding: "48px 0 64px" }}>
      <div className="wrap">
        <div className="no-print btn-row" style={{ marginBottom: 24 }}>
          <Button variant="secondary" style={{ height: 40 }} onClick={() => window.print()}>
            <Printer size={16} /> Print A4 flyer
          </Button>
          {flyer.export_pdf_url && (
            <Button variant="secondary" style={{ height: 40 }} asChild>
              <a href={flyer.export_pdf_url} download>
                <Download size={16} /> PDF
              </a>
            </Button>
          )}
          {flyer.export_png_url && (
            <Button variant="secondary" style={{ height: 40 }} asChild>
              <a href={flyer.export_png_url} download>
                <Download size={16} /> PNG
              </a>
            </Button>
          )}
          {canReward &&
            (user ? (
              <Button variant="primary" style={{ height: 40 }} onClick={() => setRewardOpen(true)}>
                <Coins size={16} /> Fund reward
              </Button>
            ) : (
              <Button variant="primary" style={{ height: 40 }} asChild>
                <Link to="/auth/login">Log in to fund reward</Link>
              </Button>
            ))}
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
              onClick={() => void updateFlyer.mutateAsync({ status: "resolved" })}
            >
              {emergency ? "Mark reunited" : found ? "Mark returned home" : "Mark adopted"}
            </Button>
          )}
          {isOwner && (
            <Button
              variant="secondary"
              style={{ height: 40 }}
              disabled={deleteFlyer.isPending}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                void deleteFlyer.mutateAsync().then(() => navigate("/my-flyers"));
              }}
            >
              {confirming ? "Click again to delete" : "Delete flyer"}
            </Button>
          )}
        </div>

        {deleteFlyer.isError && <div style={{ marginBottom: 16 }}><ErrorBox message="Could not delete the flyer. Please try again." /></div>}

        {/* Print sheet — A4 at 300dpi via @media print (.print-sheet) */}
        <article className="card print-sheet" style={{ padding: 32 }} data-testid="flyer-sheet">
          <div className="split-2">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div className="photo-frame" style={{ aspectRatio: "4 / 3", borderRadius: 20, background: "var(--color-surface)", border: "1px solid var(--color-line)", flex: 1 }}>
                  {flyer.photo_url ? (
                    <img
                      src={flyer.photo_url}
                      alt={`${petDisplayName(flyer.pet, flyer.mode)} — ${emergency ? "lost pet" : found ? "found pet" : "adoptable pet"} photo`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--color-muted)" }}>
                      No photo yet
                    </div>
                  )}
                </div>
                {qrTarget && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 150 }}>
                    <QrImage value={qrTarget} size={150} alt={`QR code linking to ${petDisplayName(flyer.pet, flyer.mode)}'s flyer`} />
                    <p className="t-label" style={{ marginTop: 2, textAlign: "center" }}>Scan to open this flyer</p>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <ModeBadge mode={flyer.mode} />
                {canReward && <RewardBadge amount={flyer.reward_amount_cents ?? 0} currency={flyer.reward_currency ?? "PHP"} />}
                <StatusBadge status={flyer.status} />
              </div>
              <h1 className="t-h1" style={{ color: accent, fontSize: "clamp(32px, 4.5vw, 48px)" }}>
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
              {canReward && (
                <p className="t-body" style={{ fontWeight: 700, color: "var(--color-emergency-deep)" }}>
                  Reward for safe return: {formatMoney(flyer.reward_amount_cents ?? 0, flyer.reward_currency ?? "PHP")}
                </p>
              )}
              <div style={{ borderTop: "1px solid var(--color-line)", paddingTop: 14, marginTop: 4 }}>
                <p className="t-label">{found ? "If this is your pet, contact" : "If found, contact"}</p>
                <p className="t-body" style={{ fontWeight: 600 }}>
                  {flyer.contact_phone || "—"}
                  {flyer.contact_email ? ` · ${flyer.contact_email}` : ""}
                </p>
                <p className="t-small" style={{ color: "var(--color-muted)" }}>
                  Posted by {flyer.creator_display_name || "a PawPrint member"} · {formatDate(flyer.created_at)}
                </p>
              </div>
            </div>
          </div>
        </article>
      </div>

      <RewardCheckoutModal flyer={flyer} open={rewardOpen} onClose={() => setRewardOpen(false)} />
    </section>
  );
}
