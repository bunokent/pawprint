import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@/test/setup";
import { mockFlyer, mockFoundFlyer } from "@/test/handlers";
import {
  createDropMarker,
  createMap,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  dropPinIcon,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  petPinIcon,
  pinRingColor,
  reverseGeocode,
  searchAddress,
} from "@/lib/maps";

const state = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(e: unknown) => void>>,
  maps: [] as Array<Record<string, any>>,
  tiles: [] as Array<{ url: string; opts: unknown }>,
  markers: [] as Array<Record<string, any>>,
  divIcons: [] as Array<{ kind: string; opts: any }>,
  failMap: false,
}));

vi.mock("leaflet", async () => {
  const { makeFakeLeaflet } = await import("@/test/fake-leaflet");
  return makeFakeLeaflet(state);
});

beforeEach(async () => {
  const { resetFakeLeafletState } = await import("@/test/fake-leaflet");
  resetFakeLeafletState(state);
});

describe("createMap", () => {
  it("creates a Leaflet map with the OSM tile layer, centred on Manila by default", () => {
    const el = document.createElement("div");
    const map = createMap(el);
    expect(state.maps).toHaveLength(1);
    expect(state.maps[0].el).toBe(el);
    expect(state.maps[0].opts).toMatchObject({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, scrollWheelZoom: true });
    expect(state.tiles).toHaveLength(1);
    expect(state.tiles[0].url).toBe(OSM_TILE_URL);
    expect(state.tiles[0].opts).toMatchObject({ maxZoom: 19, attribution: OSM_ATTRIBUTION });
    expect(map).toBe(state.maps[0]);
  });

  it("honours center/zoom/scrollWheelZoom overrides", () => {
    createMap(document.createElement("div"), { center: [14.6, 121.0], zoom: 15, scrollWheelZoom: false });
    expect(state.maps[0].opts).toMatchObject({ center: [14.6, 121.0], zoom: 15, scrollWheelZoom: false });
  });

  it("throws when map init fails — callers catch and fall back", () => {
    state.failMap = true;
    expect(() => createMap(document.createElement("div"))).toThrow("fake map init failure");
  });
});

describe("createDropMarker", () => {
  it("adds a draggable teardrop pin at the default centre", () => {
    const map = createMap(document.createElement("div"));
    const marker = createDropMarker(map);
    expect(state.markers).toHaveLength(1);
    expect(marker).toBe(state.markers[0]);
    expect(state.markers[0].latlng).toEqual({ lat: 14.5995, lng: 120.9842 });
    expect(state.markers[0].opts).toMatchObject({ draggable: true, title: "Drag the pin to the exact spot" });
    expect(state.markers[0].opts.icon).toEqual(state.divIcons[0]);
  });
});

describe("pin icons", () => {
  it("pinRingColor: green for found, red for anything else", () => {
    expect(pinRingColor("found")).toBe("#2e9e63");
    expect(pinRingColor("emergency")).toBe("#b3261e");
    expect(pinRingColor(undefined)).toBe("#b3261e");
    expect(pinRingColor(null)).toBe("#b3261e");
  });

  it("petPinIcon embeds the photo in a status-coloured ring", () => {
    const icon = petPinIcon(mockFlyer()) as unknown as { opts: { className: string; html: string; iconSize: number[] } };
    expect(icon.opts.className).toBe("pp-pin");
    expect(icon.opts.html).toContain("border-color:#b3261e");
    expect(icon.opts.html).toContain(`src="${mockFlyer().photo_url}"`);
    expect(icon.opts.html).toContain('alt="Bento"');
    expect(icon.opts.html).toContain('data-pet-name="Bento"');
    expect(icon.opts.iconSize).toEqual([56, 56]);
    const found = petPinIcon(mockFoundFlyer()) as unknown as typeof icon;
    expect(found.opts.html).toContain("border-color:#2e9e63");
  });

  it("petPinIcon adds the match halo classes when the pin has a vision match", () => {
    const matched = petPinIcon(mockFoundFlyer({ match: { flyer_id: "x", mode: "emergency", pet_name: "Bento", score: 0.9 } })) as unknown as {
      opts: { className: string; html: string };
    };
    expect(matched.opts.className).toBe("pp-pin pp-pin--match");
    expect(matched.opts.html).toContain("pp-pin__ring--match");
    expect(matched.opts.html).toContain("border-color:#2e9e63");
    // Unmatched pins stay plain.
    const plain = petPinIcon(mockFlyer()) as unknown as typeof matched;
    expect(plain.opts.className).toBe("pp-pin");
    expect(plain.opts.html).not.toContain("pp-pin__ring--match");
  });

  it("petPinIcon falls back to the pet initial and escapes HTML in attributes", () => {
    const icon = petPinIcon({ mode: "found", photo_url: "", pet: { name: "Miso" } }) as unknown as { opts: { html: string } };
    expect(icon.opts.html).toContain("pp-pin__letter");
    expect(icon.opts.html).toContain(">M</span>");
    const evil = petPinIcon({ mode: "emergency", photo_url: 'http://x/y".jpg', pet: { name: "A" } }) as unknown as { opts: { html: string } };
    expect(evil.opts.html).toContain('src="http://x/y&quot;.jpg"');
  });

  it("dropPinIcon is the crimson teardrop", () => {
    const icon = dropPinIcon() as unknown as { opts: { className: string; html: string } };
    expect(icon.opts.className).toBe("pp-drop-pin");
    expect(icon.opts.html).toContain("pp-drop-pin__dot");
  });
});

describe("Nominatim geocoding", () => {
  it("searchAddress maps results to {address, lat, lng} (Philippines only)", async () => {
    mswServer.use(
      http.get("https://nominatim.openstreetmap.org/search", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe("Makati");
        expect(url.searchParams.get("countrycodes")).toBe("ph");
        expect(url.searchParams.get("format")).toBe("jsonv2");
        return HttpResponse.json([{ display_name: "Makati City, Metro Manila", lat: "14.5547", lon: "121.0244" }]);
      }),
    );
    await expect(searchAddress("Makati")).resolves.toEqual([{ address: "Makati City, Metro Manila", lat: 14.5547, lng: 121.0244 }]);
  });

  it("searchAddress rejects on HTTP failure", async () => {
    mswServer.use(http.get("https://nominatim.openstreetmap.org/search", () => HttpResponse.json({}, { status: 500 })));
    await expect(searchAddress("x")).rejects.toThrow(/HTTP 500/);
  });

  it("reverseGeocode returns the display name", async () => {
    mswServer.use(http.get("https://nominatim.openstreetmap.org/reverse", () => HttpResponse.json({ display_name: "123 Test Street, Manila" })));
    await expect(reverseGeocode(14.61, 121.02)).resolves.toBe("123 Test Street, Manila");
  });

  it("reverseGeocode falls back to coordinates when there is no name or the request fails", async () => {
    mswServer.use(http.get("https://nominatim.openstreetmap.org/reverse", () => HttpResponse.json({})));
    await expect(reverseGeocode(14.61, 121.02)).resolves.toBe("14.61000, 121.02000");
    mswServer.use(http.get("https://nominatim.openstreetmap.org/reverse", () => HttpResponse.error()));
    await expect(reverseGeocode(14.61, 121.02)).resolves.toBe("14.61000, 121.02000");
  });
});
