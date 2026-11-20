/**
 * Leaflet (OpenStreetMap) map helpers — a real npm dependency, no API key.
 *
 * The interactive `/map` page and the lost/found LocationPicker both build on
 * these helpers: an OSM tile-layer map, circular photo `divIcon` pins, a
 * draggable drop pin, and Nominatim geocoding (address search + reverse
 * geocode). When the network is unavailable (offline e2e, unit tests) tile and
 * geocode requests simply fail and callers degrade gracefully: the picker
 * keeps its plain text input, the map keeps its pin list.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { petDisplayName } from "@/lib/utils";

/** Default map centre — Manila, where PawPrint operates. */
export const DEFAULT_CENTER: L.LatLngExpression = [14.5995, 120.9842];
export const DEFAULT_ZOOM = 12;

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export interface MapInitOptions {
  center?: L.LatLngExpression;
  zoom?: number;
  scrollWheelZoom?: boolean;
}

/**
 * Creates a Leaflet map with the OSM tile layer on the given container.
 * Throws when the container is invalid — callers catch and fall back.
 */
export function createMap(container: HTMLElement, opts: MapInitOptions = {}): L.Map {
  const { center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, scrollWheelZoom = true } = opts;
  const map = L.map(container, { center, zoom, scrollWheelZoom });
  L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
  return map;
}

/** A geocoding hit: display address plus coordinates. */
export interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

async function nominatim<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = `${NOMINATIM_BASE}${path}?${new URLSearchParams({ format: "jsonv2", ...params })}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`Nominatim ${path} failed with HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Forward geocode: address text → up to 5 candidate locations (Philippines only). */
export async function searchAddress(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const rows = await nominatim<Array<{ display_name: string; lat: string; lon: string }>>(
    "/search",
    { q: query, limit: "5", countrycodes: "ph" },
    signal,
  );
  return rows.map((r) => ({ address: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}

/**
 * Reverse geocode: coordinates → human-readable address. Falls back to a
 * "lat, lng" string when Nominatim has no name (or the request fails), so the
 * picker can always report something.
 */
export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<string> {
  try {
    const row = await nominatim<{ display_name?: string }>("/reverse", { lat: String(lat), lon: String(lng) }, signal);
    return row.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

/** Pin ring colours from the design system: red = lost, green = found. */
export const PIN_RING = { lost: "#b3261e", found: "#2e9e63" } as const;

/** Ring colour for a flyer mode — anything not "found" is treated as lost. */
export function pinRingColor(mode: string | null | undefined): string {
  return mode === "found" ? PIN_RING.found : PIN_RING.lost;
}

/** Photo-pin diameter in px (ring + circular photo). */
export const PIN_SIZE = 56;

/** Vision-match counterpart reported by the map endpoint. */
export interface PinMatch {
  flyer_id: string;
  mode: string;
  pet_name: string;
  score: number;
}

/** Minimal shape needed to build a photo pin (a Flyer is assignable to this). */
export interface PinLike {
  mode?: string | null;
  photo_url?: string | null;
  pet: { name?: string | null };
  match?: PinMatch | null;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Pin label — found pets may have no name yet. */
const pinName = (pin: PinLike): string => petDisplayName(pin.pet, pin.mode);

const pinInner = (pin: PinLike): string =>
  pin.photo_url
    ? `<img src="${esc(pin.photo_url)}" alt="${esc(pinName(pin))}" />`
    : `<span class="pp-pin__letter">${esc(pinName(pin).charAt(0).toUpperCase())}</span>`;

/**
 * Circular photo pin: the pet photo clipped to a circle (`overflow: hidden` on
 * the ring) with a status ring (red lost / green found) plus a soft glow;
 * without a photo, the pet's initial on a muted disc. Pins with a vision match
 * get an amber pulsing halo on the marker itself (`pp-pin--match`, so the ring
 * clip stays intact). Rendered as a Leaflet `divIcon`, so it works without canvas.
 */
export function petPinIcon(pin: PinLike, size = PIN_SIZE): L.DivIcon {
  const ring = pinRingColor(pin.mode);
  const matched = Boolean(pin.match);
  return L.divIcon({
    className: matched ? "pp-pin pp-pin--match" : "pp-pin",
    html: `<span class="pp-pin__ring" data-pet-name="${esc(pinName(pin))}" style="border-color:${ring};--pin-glow:${ring}">${pinInner(pin)}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/* ------------------------------------------------------------------------ */
/* Stacking — pins at the same spot (or within ~30 m) are drawn as a deck of */
/* circular cards: the newest on top with a count badge, the oldest peeking */
/* out behind it. Tapping the stack opens a popup listing every stacked flyer. */
/* ------------------------------------------------------------------------ */

/** A cluster of pins that share (nearly) the same coordinates. */
export interface PinGroup<T> {
  key: string;
  lat: number;
  lng: number;
  /** Newest first — items[0] is the top card of the stack. */
  items: T[];
}

/** Great-circle distance in metres (haversine). */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Greedy proximity clustering: pins within `maxMeters` of an existing group
 * join it (same spot or nearby), otherwise they start a new group. Groups are
 * returned oldest-first internally, then each group's items are reversed so the
 * newest flyer is the visible top card and the oldest peek out at the back.
 */
export function groupPins<T extends { location_lat?: number | null; location_lng?: number | null; created_at?: string }>(
  items: T[],
  maxMeters = 30,
): Array<PinGroup<T>> {
  const withCoords = items.filter(
    (i): i is T & { location_lat: number; location_lng: number } => i.location_lat != null && i.location_lng != null,
  );
  const sorted = [...withCoords].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const groups: Array<PinGroup<T>> = [];
  for (const item of sorted) {
    let group = groups.find((g) => haversineMeters(g.lat, g.lng, item.location_lat, item.location_lng) <= maxMeters);
    if (!group) {
      group = { key: `${item.location_lat.toFixed(6)},${item.location_lng.toFixed(6)}`, lat: item.location_lat, lng: item.location_lng, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  for (const g of groups) g.items.reverse();
  return groups;
}

/** Offset between stacked cards, in px. */
export const STACK_STEP = 7;

/**
 * Stack pin for a group of 2+ pins at the same spot: up to two back cards
 * (the oldest) peek out bottom-right, the newest flyer's circular pin sits on
 * top with a `×N` count badge. Every card keeps its own mode ring colour
 * (red lost / green found). The icon is anchored at the top card's centre.
 */
export function stackPinIcon<T extends PinLike>(group: PinGroup<T>, size = PIN_SIZE): L.DivIcon {
  const top = group.items[0];
  const backs = group.items.slice(1, 3);
  const matched = group.items.some((i) => i.match);
  const offset = backs.length * STACK_STEP;
  const backHtml = backs
    .map((b, i) => {
      const rb = pinRingColor(b.mode);
      return `<span class="pp-stack__card" style="transform:translate(${(i + 1) * STACK_STEP}px, ${(i + 1) * STACK_STEP}px);border-color:${rb};--pin-glow:${rb}">${pinInner(b)}</span>`;
    })
    .join("");
  const ring = pinRingColor(top.mode);
  const html =
    `<div class="pp-stack">${backHtml}` +
    `<span class="pp-stack__top">` +
    `<span class="pp-pin__ring" data-pet-name="${esc(pinName(top))}" data-stack-top="true" style="border-color:${ring};--pin-glow:${ring}">${pinInner(top)}</span>` +
    `<span class="pp-pin__count" data-stack-count="${group.items.length}">×${group.items.length}</span>` +
    `</span></div>`;
  return L.divIcon({
    className: matched ? "pp-pin pp-stack-pin pp-stack-pin--match" : "pp-pin pp-stack-pin",
    html,
    iconSize: [size + offset, size + offset],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/** Draggable crimson teardrop pin for the LocationPicker map. */
export function dropPinIcon(): L.DivIcon {
  return L.divIcon({
    className: "pp-drop-pin",
    html: '<span class="pp-drop-pin__dot"></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** Creates the draggable drop pin on a picker map, centred on the default view. */
export function createDropMarker(map: L.Map, center: L.LatLngExpression = DEFAULT_CENTER): L.Marker {
  return L.marker(center, {
    draggable: true,
    title: "Drag the pin to the exact spot",
    icon: dropPinIcon(),
  }).addTo(map);
}
