import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin, X } from "lucide-react";
import { flyerMapQuery, type Flyer } from "@/features/flyers/api";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ui/feedback";
import { googleMapsEnabled, loadGoogleMaps } from "@/lib/maps";
import { formatDate } from "@/lib/utils";

/** Default map centre — Manila, where PawPrint operates. */
const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 14.5995, lng: 120.9842 };

/** Photo-pin diameter in px (ring + circular photo). */
const PIN_SIZE = 56;

/** Pin ring colours from the design system: crimson = lost, terracotta = found. */
const PIN_RING = { lost: "#b3261e", found: "#c96f4a" } as const;

export function pinRingColor(mode: string | undefined): string {
  return mode === "found" ? PIN_RING.found : PIN_RING.lost;
}

/**
 * Draws the pet photo clipped to a circle with a status-coloured ring and
 * resolves to a PNG data URL for use as a marker icon. Without a photo (or
 * when canvas is unavailable) it resolves to a plain coloured dot — or null.
 */
export function petPinIcon(flyer: Flyer, size = PIN_SIZE): Promise<string | null> {
  return new Promise((resolve) => {
    const draw = (img: HTMLImageElement | null) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.fillStyle = pinRingColor(flyer.mode);
      ctx.fill();
      if (img) {
        const inner = size - 8;
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, inner / 2, 0, Math.PI * 2);
        ctx.clip();
        const scale = Math.max(inner / img.width, inner / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        ctx.restore();
      }
      resolve(canvas.toDataURL("image/png"));
    };
    if (!flyer.photo_url) return draw(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        draw(img);
      } catch {
        draw(null);
      }
    };
    img.onerror = () => draw(null);
    img.src = flyer.photo_url;
  });
}

/** Public interactive pet map: one photo pin per active lost/found flyer with coordinates. */
export function PetMapPage() {
  const query = useQuery(flyerMapQuery());
  const mapsOn = googleMapsEnabled();

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
        {query.data && query.data.length > 0 && (mapsOn ? <GooglePins flyers={query.data} /> : <PinList flyers={query.data} />)}
      </div>
    </section>
  );
}

/** Google Map with one canvas photo-pin per flyer; clicking a pin opens a popup card. */
function GooglePins({ flyers }: { flyers: Flyer[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const pins = flyers.filter((f) => f.location_lat != null && f.location_lng != null);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        const first = pins[0];
        const map = new maps.Map(containerRef.current, {
          center: first ? { lat: first.location_lat!, lng: first.location_lng! } : DEFAULT_CENTER,
          zoom: first ? 13 : 11,
          clickableIcons: false,
        });
        const bounds = new maps.LatLngBounds();
        for (const f of pins) {
          const position = { lat: f.location_lat!, lng: f.location_lng! };
          const marker = new maps.Marker({ position, map, title: `${f.pet.name} — ${f.mode}` });
          marker.addListener("click", () => setSelectedId(f.id));
          // Photo pin: swap the default marker for a circular pet photo once drawn.
          void petPinIcon(f).then((icon) => {
            if (icon) {
              marker.setIcon({
                url: icon,
                scaledSize: new maps.Size(PIN_SIZE, PIN_SIZE),
                anchor: new maps.Point(PIN_SIZE / 2, PIN_SIZE / 2),
              });
            }
          });
          bounds.extend(position);
        }
        if (pins.length > 1) map.fitBounds(bounds);
      })
      .catch(() => setLoadFailed(true));
    return () => {
      cancelled = true;
    };
    // Pins are derived from the fetched flyers; rebuild only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyers]);

  if (loadFailed) {
    return <PinList flyers={flyers} note="The map could not load — showing the pins as a list instead." />;
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

/** Fallback when no Maps key is configured (dev/test/e2e): the same pins as a list. */
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
      {!note && !googleMapsEnabled() && (
        <p className="t-small" style={{ color: "var(--color-muted)", marginBottom: 12 }}>
          Interactive map view needs a Google Maps key — showing the pins as a list.
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
