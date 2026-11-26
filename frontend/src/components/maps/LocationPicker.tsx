import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import { FieldShell, Input } from "@/components/ui/field";
import { createDropMarker, createMap, DEFAULT_CENTER, reverseGeocode, searchAddress, type GeocodeResult } from "@/lib/maps";

/** Location picked on the map: reverse-geocoded address plus raw coordinates. */
export interface LocationValue {
  address: string;
  lat: number | null;
  lng: number | null;
}

interface LocationPickerProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  value: string;
  /** Saved pin to restore after Back or a page reload. */
  initialCoords?: { lat: number; lng: number } | null;
  onChange: (value: LocationValue) => void;
}

/** Debounce for the address-search suggestions. */
const SUGGESTION_DEBOUNCE_MS = 300;

/** Minimum characters before querying Nominatim. */
const MIN_QUERY = 3;

function PlainAddressField({ id, label, hint, error, placeholder, value, initialCoords, onChange }: LocationPickerProps) {
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        placeholder={placeholder ?? "e.g. Barangay hall, Quezon City"}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onChange({
          address: e.target.value,
          lat: initialCoords?.lat ?? null,
          lng: initialCoords?.lng ?? null,
        })}
      />
    </FieldShell>
  );
}

/**
 * Location field with an embedded Leaflet (OpenStreetMap) map: Nominatim
 * address search on the text input plus a draggable pin; dropping the pin
 * reverse-geocodes the address and reports lat/lng. If the map cannot be
 * created (e.g. map unavailable) it degrades to a plain address input
 * under the same id — forms keep working, coordinates stay null.
 */
export function LocationPicker(props: LocationPickerProps) {
  const { id, label, hint, error, placeholder, value, initialCoords, onChange } = props;
  const initialLat = initialCoords?.lat ?? null;
  const initialLng = initialCoords?.lng ?? null;
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [mapFailed, setMapFailed] = useState(false);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);

  // Keep typing in sync with a restored pin before the map is ready.
  useEffect(() => {
    coordsRef.current = initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng } : null;
  }, [initialLat, initialLng]);

  // Build the map once per mount (value/onChange are read through refs).
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    let cancelled = false;
    let map: L.Map;
    try {
      map = createMap(el, { center: DEFAULT_CENTER, zoom: 12, scrollWheelZoom: false });
    } catch {
      setMapFailed(true);
      return;
    }
    mapObjRef.current = map;
    const marker = createDropMarker(map);
    markerRef.current = marker;

    // Pin dropped (map click or marker drag) → move pin + reverse-geocode.
    const emit = (lat: number, lng: number, address?: string) => {
      coordsRef.current = { lat, lng };
      marker.setLatLng([lat, lng]);
      map.panTo([lat, lng]);
      void (address !== undefined ? Promise.resolve(address) : reverseGeocode(lat, lng)).then((addr) => {
        if (!cancelled) onChangeRef.current({ address: addr, lat, lng });
      });
    };

    map.on("click", (e: L.LeafletMouseEvent) => emit(e.latlng.lat, e.latlng.lng));
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      emit(p.lat, p.lng);
    });

    return () => {
      cancelled = true;
      map.remove();
      mapObjRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapFailed]);

  // Put a saved pin back on the map after Back / reload.
  useEffect(() => {
    if (initialLat == null || initialLng == null || !mapObjRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([initialLat, initialLng]);
    mapObjRef.current.setView([initialLat, initialLng], Math.max(mapObjRef.current.getZoom(), 14), { animate: false });
  }, [initialLat, initialLng, mapFailed]);

  // Debounced Nominatim address search behind the text input.
  useEffect(() => {
    if (mapFailed) return;
    const q = value.trim();
    if (q.length < MIN_QUERY) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchAddress(q, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setSuggestions(results);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, mapFailed]);

  const pick = (r: GeocodeResult) => {
    setSuggestions([]);
    coordsRef.current = { lat: r.lat, lng: r.lng };
    markerRef.current?.setLatLng([r.lat, r.lng]);
    mapObjRef.current?.panTo([r.lat, r.lng]);
    onChangeRef.current({ address: r.address, lat: r.lat, lng: r.lng });
  };

  if (mapFailed) {
    return <PlainAddressField {...props} />;
  }

  return (
    <FieldShell
      label={label}
      htmlFor={id}
      hint={hint ?? "Search an address or drop the pin on the map — the address is filled in automatically."}
      error={error}
      after={<div ref={mapRef} data-testid={`${id}-map`} className="location-map" />}
    >
      <div style={{ position: "relative" }}>
        <Input
          id={id}
          placeholder={placeholder ?? "Search an address…"}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-expanded={suggestions.length > 0}
          aria-controls={suggestions.length > 0 ? `${id}-suggestions` : undefined}
          value={value}
          onChange={(e) =>
            onChange({
              address: e.target.value,
              // Typing keeps the last pin position (if any).
              lat: coordsRef.current?.lat ?? null,
              lng: coordsRef.current?.lng ?? null,
            })
          }
        />
        {suggestions.length > 0 && (
          <ul className="pp-suggestions" id={`${id}-suggestions`} role="listbox" aria-label="Address suggestions">
            {suggestions.map((s) => (
              <li key={`${s.lat},${s.lng}`}>
                <button type="button" role="option" aria-selected={false} onClick={() => pick(s)}>
                  {s.address}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FieldShell>
  );
}
