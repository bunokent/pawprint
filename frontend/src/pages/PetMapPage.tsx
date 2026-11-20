import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { MapPin, X } from "lucide-react";
import { flyerMapQuery, type Flyer } from "@/features/flyers/api";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";
import { createMap, petPinIcon } from "@/lib/maps";
import { formatDate } from "@/lib/utils";

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
            <MapPin size={13} /> Lost
          </span>
          <span className="badge badge--found">
            <MapPin size={13} /> Found
          </span>
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
 * Leaflet (OpenStreetMap) map with one circular photo pin per flyer; clicking
 * a pin opens a popup card. Falls back to the pin list when the map cannot be
 * created (e.g. jsdom in unit tests).
 */
function LeafletPins({ flyers }: { flyers: Flyer[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const pins = flyers.filter((f) => f.location_lat != null && f.location_lng != null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || pins.length === 0) return;
    let map: L.Map | undefined;
    try {
      const first = pins[0];
      map = createMap(el, { center: [first.location_lat!, first.location_lng!], zoom: 13 });
      const bounds = L.latLngBounds(pins.map((p) => [p.location_lat!, p.location_lng!] as L.LatLngExpression));
      for (const f of pins) {
        const marker = L.marker([f.location_lat!, f.location_lng!], {
          icon: petPinIcon(f),
          title: `${f.pet.name} — ${f.mode}`,
        }).addTo(map);
        marker.on("click", () => setSelectedId(f.id));
      }
      if (pins.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
    } catch {
      setMapFailed(true);
      return;
    }
    return () => {
      map?.remove();
    };
    // Pins are derived from the fetched flyers; rebuild only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyers]);

  if (mapFailed) {
    return <PinList flyers={flyers} note="The map could not load — showing the pins as a list instead." />;
  }
  if (pins.length === 0) {
    return <PinList flyers={flyers} />;
  }

  const selected = flyers.find((f) => f.id === selectedId) ?? null;
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
      {selected && <PinPopup flyer={selected} onClose={() => setSelectedId(null)} />}
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
        <button
          type="button"
          aria-label="Close popup"
          onClick={onClose}
          style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "var(--color-muted)", display: "inline-flex" }}
        >
          <X size={16} />
        </button>
      </div>
      <strong style={{ fontSize: 17, fontFamily: "var(--font-display)" }}>{flyer.pet.name}</strong>
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
                <img src={flyer.photo_url} alt={flyer.pet.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
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
              <h3 className="t-h3">{flyer.pet.name}</h3>
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
