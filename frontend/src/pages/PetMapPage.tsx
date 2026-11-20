import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { MapPin, Sparkles, X } from "lucide-react";
import { flyerMapQuery, type Flyer } from "@/features/flyers/api";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";
import { createMap, groupPins, petPinIcon, pinRingColor, stackPinIcon, type PinGroup } from "@/lib/maps";
import { formatDate, petDisplayName } from "@/lib/utils";

/** Public interactive pet map: one photo pin per active lost/found flyer with coordinates. */
export function PetMapPage() {
  const query = useQuery(flyerMapQuery());

  return (
    <section style={{ padding: "64px 0" }}>
      <div className="wrap">
        <h1 className="t-h1" data-enter style={{ marginBottom: 8 }}>
          Pet map
        </h1>
        <p className="t-lead" data-enter="2" style={{ marginBottom: 16, maxWidth: 640 }}>
          Every active lost or found pet with a pinned location — tap a photo pin to see the details.
        </p>
        <div className="btn-row" data-enter="3" style={{ marginBottom: 24 }} aria-label="Pin legend">
          <span className="badge badge--emergency">
            <MapPin size={13} /> Lost — red pin
          </span>
          <span className="badge badge--found">
            <MapPin size={13} /> Found — green pin
          </span>
          {query.data?.some((f) => f.match) && (
            <span className="badge badge--match">
              <Sparkles size={13} /> Possible match
            </span>
          )}
        </div>

        {query.isLoading && <Skeleton style={{ height: 420, borderRadius: 20 }} />}
        {query.isError && <ErrorBox message="Could not load the pet map. Please try again." />}
        {query.data && query.data.length === 0 && (
          <EmptyState title="No pinned pets yet">
            <p>Lost and found flyers with a map location will appear here.</p>
          </EmptyState>
        )}
        {query.data && query.data.length > 0 && <LeafletPins flyers={query.data} />}
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
          // Centre the tapped circle pin on the map (no-op when already in view
          // is handled by Leaflet's pan animation; keeps edge pins visible).
          map?.panTo([g.lat, g.lng]);
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
          height: "min(70vh, 640px)",
          minHeight: 380,
          borderRadius: 20,
          border: "1px solid var(--color-line)",
          overflow: "hidden",
          background: "var(--color-surface)",
        }}
      />
      {selected && selected.items.length > 1 && <StackPopup group={selected} onClose={() => setSelectedKey(null)} />}
      {selected && selected.items.length === 1 && <PinPopup flyer={selected.items[0]} onClose={() => setSelectedKey(null)} />}
    </div>
  );
}

/** Popup for a stack of pins at the same spot: every stacked flyer as a row. */
function StackPopup({ group, onClose }: { group: PinGroup<Flyer>; onClose: () => void }) {
  return (
    <div
      className="card"
      data-testid="map-pin-popup"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 10,
        width: 300,
        maxHeight: 380,
        overflowY: "auto",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className="badge badge--neutral" data-testid="stack-count-badge">
          ×{group.items.length} stacked here
        </span>
        <button
          type="button"
          aria-label="Close popup"
          onClick={onClose}
          style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "var(--color-muted)", display: "inline-flex" }}
        >
          <X size={16} />
        </button>
      </div>
      <p className="t-small" style={{ margin: 0, color: "var(--color-muted)" }}>
        {group.items.length} pets pinned at the same spot — tap one for its details:
      </p>
      {group.items.map((flyer) => (
        <div
          key={flyer.id}
          data-testid="stack-card"
          style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--color-line)" }}
        >
          <span
            className="pp-pin__ring"
            style={{ width: 36, height: 36, flex: "none", borderColor: pinRingColor(flyer.mode), "--pin-glow": pinRingColor(flyer.mode) } as React.CSSProperties}
          >
            {flyer.photo_url ? (
              <img src={flyer.photo_url} alt={petDisplayName(flyer.pet, flyer.mode)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span className="pp-pin__letter" style={{ fontSize: 15 }}>{petDisplayName(flyer.pet, flyer.mode).charAt(0).toUpperCase()}</span>
            )}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 14, fontFamily: "var(--font-display)" }}>{petDisplayName(flyer.pet, flyer.mode)}</strong>
            <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
              <ModeBadge mode={flyer.mode} />
              {flyer.match && (
                <span className="badge badge--match" title={`Photo match confidence ${(flyer.match.score * 100).toFixed(0)}%`}>
                  <Sparkles size={11} /> Match
                </span>
              )}
            </div>
          </div>
          <Button variant={flyer.mode === "found" ? "found" : "emergency"} style={{ height: 32, flex: "none" }} asChild>
            <Link to={`/flyers/${flyer.id}`}>Open</Link>
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Popup card shown when a pin is tapped: details + link to the flyer page. */
function PinPopup({ flyer, onClose }: { flyer: Flyer; onClose: () => void }) {
  return (
    <div
      className="card"
      data-testid="map-pin-popup"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 10,
        width: 264,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <ModeBadge mode={flyer.mode} />
        <StatusBadge status={flyer.status} />
        {flyer.match && (
          <span className="badge badge--match" title={`Photo match confidence ${(flyer.match.score * 100).toFixed(0)}%`}>
            <Sparkles size={12} /> Match
          </span>
        )}
        <button
          type="button"
          aria-label="Close popup"
          onClick={onClose}
          style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "var(--color-muted)", display: "inline-flex" }}
        >
          <X size={16} />
        </button>
      </div>
      {flyer.match && (
        <p className="t-small" data-testid="pin-match-banner" style={{ margin: 0, color: "#7a5200", background: "rgb(255 179 0 / 0.14)", borderRadius: 8, padding: "6px 10px" }}>
          Possible photo match with <strong>{flyer.match.pet_name}</strong> ({(flyer.match.score * 100).toFixed(0)}%) —{" "}
          <Link to={`/flyers/${flyer.match.flyer_id}`}>open the other flyer</Link>
        </p>
      )}
      <strong style={{ fontSize: 17, fontFamily: "var(--font-display)" }}>{petDisplayName(flyer.pet, flyer.mode)}</strong>
      <p className="t-small" style={{ margin: 0, color: "var(--color-muted)" }}>
        {[flyer.pet.species, flyer.pet.breed, flyer.pet.color].filter(Boolean).join(" · ")}
      </p>
      <p className="t-small" style={{ margin: 0 }}>
        {flyer.mode === "found" ? "Found" : "Last seen"} {flyer.last_seen_date ? formatDate(flyer.last_seen_date) : "—"}
        {flyer.last_seen_location ? ` · ${flyer.last_seen_location}` : ""}
      </p>
      <Button variant={flyer.mode === "found" ? "found" : "emergency"} style={{ height: 40 }} asChild>
        <Link to={`/flyers/${flyer.id}`}>Show Full Details</Link>
      </Button>
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
        <p className="t-small" style={{ color: "var(--color-muted)", marginBottom: 12 }}>
          {note}
        </p>
      )}
      <div data-testid="pin-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
        {list.map((flyer) => (
          <div key={flyer.id} className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="photo-frame" style={{ aspectRatio: "4 / 3", background: "var(--color-surface)" }}>
              {flyer.photo_url ? (
                <img src={flyer.photo_url} alt={petDisplayName(flyer.pet, flyer.mode)} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--color-muted)" }}>
                  No photo yet
                </div>
              )}
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <ModeBadge mode={flyer.mode} />
                <StatusBadge status={flyer.status} />
              </div>
              <h3 className="t-h3">{petDisplayName(flyer.pet, flyer.mode)}</h3>
              <p className="t-small" style={{ margin: 0, color: "var(--color-muted)" }}>
                {[flyer.pet.species, flyer.pet.breed, flyer.pet.color].filter(Boolean).join(" · ")}
              </p>
              <p className="t-small" style={{ margin: 0, color: "var(--color-muted)" }}>
                {flyer.mode === "found" ? "Found" : "Last seen"} {flyer.last_seen_date ? formatDate(flyer.last_seen_date) : "—"}
                {flyer.last_seen_location ? ` · ${flyer.last_seen_location}` : ""}
              </p>
              <Button variant={flyer.mode === "found" ? "found" : "emergency"} style={{ height: 40 }} asChild>
                <Link to={`/flyers/${flyer.id}`}>Show Full Details</Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
