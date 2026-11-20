/**
 * Shared fake of the `leaflet` module for unit tests (jsdom has no real map
 * rendering). Test files register it with:
 *
 *   const state = vi.hoisted(() => newFakeLeafletState());
 *   vi.mock("leaflet", async () => {
 *     const { makeFakeLeaflet } = await import("@/test/fake-leaflet");
 *     return makeFakeLeaflet(state);
 *   });
 *
 * and then drive it through `state.listeners` / `state.markers` / `state.maps`.
 */

export interface FakeLeafletState {
  listeners: Record<string, Array<(e: unknown) => void>>;
  maps: Array<Record<string, any>>;
  tiles: Array<{ url: string; opts: unknown }>;
  markers: Array<Record<string, any>>;
  divIcons: Array<{ kind: string; opts: any }>;
  /** When true, L.map throws — exercises the components' fallback paths. */
  failMap: boolean;
}

export function newFakeLeafletState(): FakeLeafletState {
  return { listeners: {}, maps: [], tiles: [], markers: [], divIcons: [], failMap: false };
}

export function resetFakeLeafletState(state: FakeLeafletState): void {
  state.listeners = {};
  state.maps.length = 0;
  state.tiles.length = 0;
  state.markers.length = 0;
  state.divIcons.length = 0;
  state.failMap = false;
}

/** Normalises Leaflet latlng inputs (arrays or {lat,lng}) to {lat,lng}. */
function normLatLng(ll: unknown): unknown {
  if (Array.isArray(ll)) return { lat: ll[0], lng: ll[1] };
  return ll;
}

/** Builds the mocked `leaflet` module (default + named exports) bound to `state`. */
export function makeFakeLeaflet(state: FakeLeafletState): Record<string, unknown> {
  const L: Record<string, any> = {
    map: (el: HTMLElement, opts: unknown) => {
      if (state.failMap) throw new Error("fake map init failure");
      const m: Record<string, any> = {
        el,
        opts,
        removed: false,
        panTos: [] as unknown[],
        on(name: string, cb: (e: unknown) => void) {
          (state.listeners[`map:${name}`] ??= []).push(cb);
          return m;
        },
        panTo(ll: unknown) {
          m.panTos.push(normLatLng(ll));
        },
        setView() {},
        fitBounds() {},
        remove() {
          m.removed = true;
        },
      };
      state.maps.push(m);
      return m;
    },
    tileLayer: (url: string, opts: unknown) => {
      const t = { url, opts, addTo: () => t };
      state.tiles.push(t);
      return t;
    },
    marker: (latlng: unknown, opts: unknown) => {
      const mk: Record<string, any> = {
        latlng: normLatLng(latlng),
        opts,
        on(name: string, cb: (e: unknown) => void) {
          (state.listeners[`marker:${name}`] ??= []).push(cb);
          return mk;
        },
        addTo: () => mk,
        setLatLng(ll: unknown) {
          mk.latlng = normLatLng(ll);
        },
        getLatLng() {
          return mk.latlng;
        },
        remove() {},
      };
      state.markers.push(mk);
      return mk;
    },
    divIcon: (opts: unknown) => {
      const icon = { kind: "divIcon", opts };
      state.divIcons.push(icon);
      return icon;
    },
    latLngBounds: (lls: unknown) => ({ lls }),
    latLng: (lat: number, lng: number) => ({ lat, lng }),
  };
  return { default: L, ...L };
}
