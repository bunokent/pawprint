import { useEffect, useRef, useState } from "react";
import { FieldShell, Input } from "@/components/ui/field";
import { googleMapsEnabled, loadGoogleMaps } from "@/lib/maps";

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
  onChange: (value: LocationValue) => void;
}

/** Default map centre — Manila, where PawPrint operates. */
const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 14.5995, lng: 120.9842 };

function PlainAddressField({ id, label, hint, error, placeholder, value, onChange }: LocationPickerProps) {
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        placeholder={placeholder ?? "e.g. Barangay hall, Quezon City"}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        value={value}
        onChange={(e) => onChange({ address: e.target.value, lat: null, lng: null })}
      />
    </FieldShell>
  );
}

/**
 * Location field with an embedded Google Map: Places Autocomplete on the text
 * input plus a draggable pin; dropping the pin reverse-geocodes the address and
 * reports lat/lng. Without a VITE_GOOGLE_MAPS_API_KEY (or if the script fails to
 * load) it degrades to a plain address input under the same id — forms and e2e
 * keep working, coordinates simply stay null.
 */
export function LocationPicker(props: LocationPickerProps) {
  if (!googleMapsEnabled()) {
    return <PlainAddressField {...props} />;
  }
  return <MapLocationPicker {...props} />;
}

function MapLocationPicker({ id, label, hint, error, placeholder, value, onChange }: LocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;
        const map = new maps.Map(mapRef.current, {
          center: DEFAULT_CENTER,
          zoom: 12,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        const marker = new maps.Marker({
          map,
          position: DEFAULT_CENTER,
          draggable: true,
          title: "Drag the pin to the exact spot",
        });
        markerRef.current = marker;
        const geocoder = new maps.Geocoder();

        // Pin dropped (map click or marker drag) → move pin + reverse-geocode.
        const emit = (lat: number, lng: number) => {
          coordsRef.current = { lat, lng };
          marker.setPosition({ lat, lng });
          map.panTo({ lat, lng });
          geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            const address =
              status === "OK" && results && results.length > 0
                ? results[0].formatted_address
                : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            onChangeRef.current({ address, lat, lng });
          });
        };

        map.addListener("click", (e) => {
          if (e.latLng) emit(e.latLng.lat(), e.latLng.lng());
        });
        marker.addListener("dragend", (e) => {
          if (e.latLng) emit(e.latLng.lat(), e.latLng.lng());
        });

        // Optional Places Autocomplete on the address input.
        if (inputRef.current) {
          const autocomplete = new maps.places.Autocomplete(inputRef.current, {
            fields: ["geometry", "formatted_address"],
          });
          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();
            const loc = place.geometry?.location;
            if (loc) {
              emit(loc.lat(), loc.lng());
            } else if (place.formatted_address) {
              onChangeRef.current({ address: place.formatted_address, lat: null, lng: null });
            }
          });
        }
      })
      .catch(() => setLoadFailed(true));
    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
    };
    // The map is built once per mount; value/onChange are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadFailed) {
    return <PlainAddressField id={id} label={label} hint={hint} error={error} placeholder={placeholder} value={value} onChange={onChange} />;
  }

  return (
    <FieldShell
      label={label}
      htmlFor={id}
      hint={hint ?? "Search an address or drop the pin on the map — the address is filled in automatically."}
      error={error}
    >
      <Input
        ref={inputRef}
        id={id}
        placeholder={placeholder ?? "Search an address…"}
        autoComplete="off"
        aria-invalid={Boolean(error)}
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
      <div
        ref={mapRef}
        data-testid={`${id}-map`}
        style={{
          height: 260,
          marginTop: 10,
          borderRadius: 16,
          border: "1px solid var(--color-line)",
          overflow: "hidden",
          background: "var(--color-surface)",
        }}
      />
    </FieldShell>
  );
}
