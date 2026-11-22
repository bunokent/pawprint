import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { MapPin, X } from "lucide-react";
import { flyerMapQuery, type Flyer } from "@/features/flyers/api";
import { Button } from "@/components/ui/button";
import { ModeBadge, RewardBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";
import { createMap, groupPins, petPinIcon, pinRingColor, stackPinIcon, type PinGroup } from "@/lib/maps";
import { cn, formatDate, petDisplayName } from "@/lib/utils";

/** Public interactive pet map: one photo pin per active lost/found flyer with coordinates. */
export function PetMapPage() {
  const query = useQuery(flyerMapQuery());
  const [filterMode, setFilterMode] = useState<"all" | "emergency" | "found">("all");

  const allFlyers = query.data ?? [];
  const lostCount = useMemo(() => allFlyers.filter((f) => f.mode === "emergency").length, [allFlyers]);
  const foundCount = useMemo(() => allFlyers.filter((f) => f.mode === "found").length, [allFlyers]);

  const filteredFlyers = useMemo(() => {
    if (filterMode === "emergency") return allFlyers.filter((f) => f.mode === "emergency");
    if (filterMode === "found") return allFlyers.filter((f) => f.mode === "found");
    return allFlyers;
  }, [allFlyers, filterMode]);

  return (
    <section style={{ padding: "64px 0" }}>
      <div className="wrap">
        <h1 className="t-h1" data-enter style={{ marginBottom: 8 }}>
          Pet map
        </h1>
        <p className="t-lead" data-enter="2" style={{ marginBottom: 20, maxWidth: 640 }}>
          Every active lost or found pet with a pinned location — tap a photo pin to see the details.
        </p>
        <div className="btn-row" data-enter="3" style={{ marginBottom: 24, flexWrap: "wrap", gap: 8 }} aria-label="Pin legend">
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={cn("badge badge--neutral map-filter-btn", filterMode === "all" && "map-filter-btn--active")}
            style={{ border: "none" }}
          >
            All pets ({allFlyers.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode(filterMode === "emergency" ? "all" : "emergency")}
            className={cn("badge badge--emergency map-filter-btn", filterMode === "emergency" && "map-filter-btn--active")}
            style={{ border: "none" }}
          >
            <MapPin size={13} /> Lost — red pin ({lostCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode(filterMode === "found" ? "all" : "found")}
            className={cn("badge badge--found map-filter-btn", filterMode === "found" && "map-filter-btn--active")}
            style={{ border: "none" }}
          >
            <MapPin size={13} /> Found — green pin ({foundCount})
          </button>
        </div>

        {query.isLoading && <Skeleton style={{ height: 480, borderRadius: 20 }} />}
        {query.isError && <ErrorBox message="Could not load the pet map. Please try again." />}
        {query.data && query.data.length === 0 && (
          <EmptyState title="No pinned pets yet">
            <p>Lost and found flyers with a map location will appear here.</p>
          </EmptyState>
        )}
        {query.data && query.data.length > 0 && <LeafletPins flyers={filteredFlyers} />}
      </div>
    </section>
  );
}

/**
 * Leaflet (OpenStreetMap) map with one circular photo pin per flyer; pins at
 * the same spot (or within ~30 m) stack into a card deck with a ×N badge.
 * Clicking a pin opens a popup card (all stacked flyers for a stack).
 * Falls back to the pin list when the map cannot be created (e.g. jsdom).
 */
function LeafletPins({ flyers }: { flyers: Flyer[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const pins = flyers.filter((f) => f.location_lat != null && f.location_lng != null);
  const groups = useMemo(() => groupPins(pins), [pins]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || groups.length === 0) return;
    let map: L.Map | undefined;
    try {
      const first = groups[0];
      map = createMap(el, { center: [first.lat, first.lng], zoom: 13 });
      const bounds = L.latLngBounds(groups.map((g) => [g.lat, g.lng] as L.LatLngExpression));
      for (const g of groups) {
        const stacked = g.items.length > 1;
        const marker = L.marker([g.lat, g.lng], {
          icon: stacked ? stackPinIcon(g) : petPinIcon(g.items[0]),
          title: stacked
            ? `${g.items.length} pets at this spot — ${g.items.map((f) => petDisplayName(f.pet, f.mode)).join(", ")}`
            : `${petDisplayName(g.items[0].pet, g.items[0].mode)} — ${g.items[0].mode}`,
        }).addTo(map);
        marker.on("click", () => {
          setSelectedKey(g.key);
          map?.flyTo([g.lat, g.lng], Math.max(map.getZoom(), 15), { animate: true, duration: 0.6 });
        });
      }
      if (groups.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
    } catch {
      setMapFailed(true);
      return;
    }
    return () => {
      map?.remove();
    };
    // Groups are derived from the fetched flyers; rebuild only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyers]);

  if (mapFailed) {
    return <PinList flyers={flyers} note="The map could not load — showing the pins as a list instead." />;
  }
  if (pins.length === 0) {
    return <PinList flyers={flyers} />;
  }

  const selected = groups.find((g) => g.key === selectedKey) ?? null;
  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        data-testid="pet-map"
        style={{
          height: "min(72vh, 660px)",
          minHeight: 420,
          borderRadius: 20,
          border: "1px solid var(--color-line)",
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
          background: "var(--color-surface)",
        }}
      />
      <div
        className="map-floating-status"
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          zIndex: 10,
          background: "rgb(255 253 248 / 0.94)",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--color-line)",
          borderRadius: 999,
          padding: "6px 14px",
          boxShadow: "var(--shadow-card)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--color-ink)",
          fontWeight: 600,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--color-found)",
          }}
        />
        <span>{pins.length} {pins.length === 1 ? "pet" : "pets"} on map</span>
      </div>
      {selected && selected.items.length > 1 && <StackPopup group={selected} onClose={() => setSelectedKey(null)} />}
      {selected && selected.items.length === 1 && <PinPopup flyer={selected.items[0]} onClose={() => setSelectedKey(null)} />}
    </div>
  );
}

/** Popup for a stack of pins at the same spot: every stacked flyer as a row. */
function StackPopup({ group, onClose }: { group: PinGroup<Flyer>; onClose: () => void }) {
  return (
    <div
      className="card map-popup-card"
      data-testid="map-pin-popup"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 10,
        width: 320,
        maxWidth: "calc(100% - 32px)",
        maxHeight: 400,
        overflowY: "auto",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lift)",
        border: "1.5px solid var(--color-line)",
        background: "rgb(255 253 248 / 0.98)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="badge badge--neutral" data-testid="stack-count-badge" style={{ fontWeight: 700 }}>
          ×{group.items.length} stacked here
        </span>
        <button
          type="button"
          aria-label="Close popup"
          onClick={onClose}
          style={{
            marginLeft: "auto",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <X size={16} />
        </button>
      </div>
      <p className="t-small" style={{ margin: 0, color: "var(--color-muted)" }}>
        {group.items.length} pets pinned at the same spot — tap one for its details:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {group.items.map((flyer) => (
          <div
            key={flyer.id}
            data-testid="stack-card"
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "8px 4px",
              borderTop: "1px solid var(--color-line)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <span
              className="pp-pin__ring"
              style={{
                width: 38,
                height: 38,
                flex: "none",
                borderColor: pinRingColor(flyer.mode),
                "--pin-glow": pinRingColor(flyer.mode),
              } as React.CSSProperties}
            >
              {flyer.photo_url ? (
                <img
                  src={flyer.photo_url}
                  alt={petDisplayName(flyer.pet, flyer.mode)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span className="pp-pin__letter" style={{ fontSize: 15 }}>
                  {petDisplayName(flyer.pet, flyer.mode).charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 14, fontFamily: "var(--font-display)", display: "block" }}>
                {petDisplayName(flyer.pet, flyer.mode)}
              </strong>
              <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                <ModeBadge mode={flyer.mode} />
              </div>
            </div>
            <Button
              variant={flyer.mode === "found" ? "found" : "emergency"}
              style={{ height: 32, padding: "0 12px", flex: "none", fontSize: 13 }}
              asChild
            >
              <Link to={`/flyers/${flyer.id}`}>Open</Link>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Popup card shown when a pin is tapped: details + link to the flyer page. */
function PinPopup({ flyer, onClose }: { flyer: Flyer; onClose: () => void }) {
  const emergency = flyer.mode === "emergency";
  const found = flyer.mode === "found";
  const accent = emergency
    ? "var(--color-emergency-deep)"
    : found
    ? "var(--color-found-deep)"
    : "var(--color-sage-deep)";

  const displayName = petDisplayName(flyer.pet, flyer.mode);

  return (
    <div
      className="card map-popup-card"
      data-testid="map-pin-popup"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 10,
        width: 300,
        maxWidth: "calc(100% - 32px)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lift)",
        border: "1.5px solid var(--color-line)",
        background: "rgb(255 253 248 / 0.98)",
        backdropFilter: "blur(12px)",
        padding: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {flyer.photo_url && (
        <div className="photo-frame" style={{ width: "100%", aspectRatio: "16 / 10", background: "var(--color-surface)", position: "relative" }}>
          <img
            src={flyer.photo_url}
            alt={displayName}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <button
            type="button"
            aria-label="Close popup"
            onClick={onClose}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "1px solid var(--color-line)",
              background: "rgb(255 253 248 / 0.88)",
              backdropFilter: "blur(6px)",
              cursor: "pointer",
              color: "var(--color-ink)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <ModeBadge mode={flyer.mode} />
          <StatusBadge status={flyer.status} />
          {flyer.reward_enabled && (flyer.reward_amount_cents ?? 0) > 0 && (
            <RewardBadge amount={flyer.reward_amount_cents ?? 0} currency={flyer.reward_currency ?? "PHP"} />
          )}
          {!flyer.photo_url && (
            <button
              type="button"
              aria-label="Close popup"
              onClick={onClose}
              style={{
                marginLeft: "auto",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--color-muted)",
                display: "inline-flex",
                padding: 4,
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <strong style={{ fontSize: 18, fontFamily: "var(--font-display)", color: accent, lineHeight: 1.25 }}>
          {displayName}
        </strong>

        <p className="t-small" style={{ margin: 0, color: "var(--color-muted)", lineHeight: 1.4 }}>
          {[flyer.pet.species, flyer.pet.breed, flyer.pet.color].filter(Boolean).join(" · ")}
        </p>

        <p className="t-small" style={{ margin: 0, color: "var(--color-ink)", lineHeight: 1.45 }}>
          {flyer.mode === "found" ? "Found" : "Last seen"} {flyer.last_seen_date ? formatDate(flyer.last_seen_date) : "—"}
          {flyer.last_seen_location ? ` · ${flyer.last_seen_location}` : ""}
        </p>

        <Button variant={flyer.mode === "found" ? "found" : "emergency"} style={{ height: 40, width: "100%", marginTop: 4 }} asChild>
          <Link to={`/flyers/${flyer.id}`}>Show Full Details</Link>
        </Button>
      </div>
    </div>
  );
}

/** Fallback when the map cannot be created: the same pins as a list. */
function PinList({ flyers, note }: { flyers: Flyer[]; note?: string }) {
  const pins = flyers.filter((f) => f.location_lat != null && f.location_lng != null);
  const list = pins.length > 0 ? pins : flyers;
  return (
    <div>
      {note && (
        <p className="t-small" style={{ color: "var(--color-muted)", marginBottom: 16 }}>
          {note}
        </p>
      )}
      <div data-testid="pin-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
        {list.map((flyer) => (
          <div key={flyer.id} className="card flyer-card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="photo-frame flyer-card__photo">
              {flyer.photo_url ? (
                <img
                  src={flyer.photo_url}
                  alt={petDisplayName(flyer.pet, flyer.mode)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  loading="lazy"
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--color-muted)", background: "var(--color-surface)" }}>
                  No photo yet
                </div>
              )}
            </div>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <ModeBadge mode={flyer.mode} />
                <StatusBadge status={flyer.status} />
              </div>
              <h3 className="t-h3" style={{ margin: 0, fontFamily: "var(--font-display)" }}>
                {petDisplayName(flyer.pet, flyer.mode)}
              </h3>
              <p className="t-small" style={{ margin: 0, color: "var(--color-muted)" }}>
                {[flyer.pet.species, flyer.pet.breed, flyer.pet.color].filter(Boolean).join(" · ")}
              </p>
              <p className="t-small" style={{ margin: 0 }}>
                {flyer.mode === "found" ? "Found" : "Last seen"} {flyer.last_seen_date ? formatDate(flyer.last_seen_date) : "—"}
                {flyer.last_seen_location ? ` · ${flyer.last_seen_location}` : ""}
              </p>
              <Button variant={flyer.mode === "found" ? "found" : "emergency"} style={{ height: 40, width: "100%", marginTop: "auto" }} asChild>
                <Link to={`/flyers/${flyer.id}`}>Show Full Details</Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
