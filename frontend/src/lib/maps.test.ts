import fs from "node:fs";
import path from "node:path";
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
  groupPins,
  haversineMeters,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  petPinIcon,
  pinRingColor,
  reverseGeocode,
  searchAddress,
  stackPinIcon,
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

  it("petPinIcon always renders the plain marker class with the status ring on the inner ring", () => {
    const lost = petPinIcon(mockFlyer()) as unknown as { opts: { className: string; html: string } };
    expect(lost.opts.className).toBe("pp-pin");
    expect(lost.opts.html).toContain("pp-pin__ring");
    expect(lost.opts.html).toContain("border-color:#b3261e");
    const found = petPinIcon(mockFoundFlyer()) as unknown as typeof lost;
    expect(found.opts.className).toBe("pp-pin");
    expect(found.opts.html).toContain("pp-pin__ring");
    expect(found.opts.html).toContain("border-color:#2e9e63");
  });

  it("petPinIcon falls back to the pet initial, 'Found pet' for unnamed found pets, and escapes HTML", () => {
    const icon = petPinIcon({ mode: "found", photo_url: "", pet: { name: "Miso" } }) as unknown as { opts: { html: string } };
    expect(icon.opts.html).toContain("pp-pin__letter");
    expect(icon.opts.html).toContain(">M</span>");
    const unnamed = petPinIcon({ mode: "found", photo_url: "", pet: { name: "" } }) as unknown as { opts: { html: string } };
    expect(unnamed.opts.html).toContain('data-pet-name="Found pet"');
    expect(unnamed.opts.html).toContain(">F</span>");
    const evil = petPinIcon({ mode: "emergency", photo_url: 'http://x/y".jpg', pet: { name: "A" } }) as unknown as { opts: { html: string } };
    expect(evil.opts.html).toContain('src="http://x/y&quot;.jpg"');
  });

  it("dropPinIcon is the crimson teardrop", () => {
    const icon = dropPinIcon() as unknown as { opts: { className: string; html: string } };
    expect(icon.opts.className).toBe("pp-drop-pin");
    expect(icon.opts.html).toContain("pp-drop-pin__dot");
  });
});

describe("pin stacking", () => {
  const at = (lat: number, lng: number, created_at: string) => ({ location_lat: lat, location_lng: lng, created_at });

  it("haversineMeters measures real distances", () => {
    expect(haversineMeters(14.5995, 120.9842, 14.5995, 120.9842)).toBe(0);
    // ~111 m per 0.001° of latitude.
    expect(haversineMeters(14.5995, 120.9842, 14.6005, 120.9842)).toBeGreaterThan(100);
    expect(haversineMeters(14.5995, 120.9842, 14.6005, 120.9842)).toBeLessThan(125);
  });

  it("groupPins stacks pins at the same spot and nearby pins (≤30 m) into one group", () => {
    const groups = groupPins([
      at(14.5995, 120.9842, "2026-11-01T00:00:00Z"),
      at(14.5995, 120.9842, "2026-11-05T00:00:00Z"), // exact same spot
      at(14.59955, 120.98422, "2026-11-03T00:00:00Z"), // ~6 m away
      at(14.62, 121.02, "2026-11-02T00:00:00Z"), // far away
      { location_lat: null, location_lng: null, created_at: "2026-11-04T00:00:00Z" }, // no coords — skipped
    ]);
    expect(groups).toHaveLength(2);
    const stack = groups.find((g) => g.items.length === 3)!;
    expect(stack.items.map((i) => i.created_at)).toEqual([
      "2026-11-05T00:00:00Z", // newest on top of the deck
      "2026-11-03T00:00:00Z",
      "2026-11-01T00:00:00Z", // oldest peeking at the back
    ]);
    expect(groups.find((g) => g.items.length === 1)!.items[0].created_at).toBe("2026-11-02T00:00:00Z");
  });

  it("groupPins keeps distant pins separate", () => {
    const groups = groupPins([at(14.5995, 120.9842, "2026-11-01T00:00:00Z"), at(14.61, 120.99, "2026-11-02T00:00:00Z")]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it("stackPinIcon renders a card deck: top pin + count badge + peeking back cards with their mode rings", () => {
    const spot = { location_lat: 14.5995, location_lng: 120.9842 };
    const lost = mockFlyer({ ...spot, created_at: "2026-11-01T00:00:00Z" }); // red ring, oldest → back card
    const found = mockFoundFlyer({ ...spot, created_at: "2026-11-05T00:00:00Z" }); // green ring, newest → top
    const group = groupPins([lost, found])[0];
    const icon = stackPinIcon(group) as unknown as { opts: { className: string; html: string; iconSize: number[]; iconAnchor: number[] } };
    expect(icon.opts.className).toBe("pp-pin pp-stack-pin");
    expect(icon.opts.html).toContain('data-stack-count="2"');
    expect(icon.opts.html).toContain("×2");
    // Top card is the newest flyer with its own ring colour and stays a circle (data-stack-top).
    expect(icon.opts.html).toContain('data-stack-top="true"');
    expect(icon.opts.html).toContain('data-pet-name="Miso"');
    expect(icon.opts.html).toContain("border-color:#2e9e63");
    // The oldest peeks out behind as a back card with the lost (red) ring.
    expect(icon.opts.html).toContain("pp-stack__card");
    expect(icon.opts.html).toContain("border-color:#b3261e");
    expect(icon.opts.html).toContain("translate(7px, 7px)");
    // Icon is larger than one pin to fit the offset back card, anchored at the top card's centre.
    expect(icon.opts.iconSize).toEqual([63, 63]);
    expect(icon.opts.iconAnchor).toEqual([28, 28]);
  });

  it("stackPinIcon shows at most two back cards for a four-pin stack", () => {
    const spot = { location_lat: 14.5995, location_lng: 120.9842 };
    const items = [
      mockFlyer({ ...spot, created_at: "2026-11-01T00:00:00Z", id: "a" }),
      mockFoundFlyer({ ...spot, created_at: "2026-11-02T00:00:00Z", id: "b" }),
      mockFlyer({ ...spot, created_at: "2026-11-03T00:00:00Z", id: "c" }),
      mockFoundFlyer({ ...spot, created_at: "2026-11-04T00:00:00Z", id: "d" }),
    ];
    const group = groupPins(items)[0];
    const icon = stackPinIcon(group) as unknown as { opts: { className: string; html: string; iconSize: number[] } };
    expect(icon.opts.html).toContain('data-stack-count="4"');
    expect(icon.opts.html.match(/pp-stack__card/g)).toHaveLength(2);
    expect(icon.opts.html).toContain("translate(14px, 14px)");
    expect(icon.opts.iconSize).toEqual([70, 70]);
    expect(icon.opts.className).toBe("pp-pin pp-stack-pin");
  });

  it("pin photos are centred in the circle: leaflet-scoped CSS beats Leaflet's `width:auto` marker rule", () => {
    // Leaflet's own stylesheet sets `.leaflet-container .leaflet-marker-pane img
    // { width: auto; max-width: none !important; }` (specificity 0,2,1), which
    // outranked the plain `.pp-pin__ring img` rule and left pin photos at their
    // intrinsic aspect ratio instead of filling the circle. The scoped override
    // must keep width/height 100% + object-position center for pin and stack imgs.
    const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
    const scoped = css.match(
      /\.leaflet-container \.leaflet-marker-pane \.pp-pin__ring img[^{]*\{([^}]*)\}/,
    );
    expect(scoped, "leaflet-scoped pin img rule must exist").toBeTruthy();
    expect(scoped![1]).toContain("width: 100%");
    expect(scoped![1]).toContain("height: 100%");
    const fit = css.match(
      /\.leaflet-container \.leaflet-marker-pane \.pp-pin__ring img,\s*\.leaflet-container \.leaflet-marker-pane \.pp-stack__card img\s*\{([^}]*)\}/,
    );
    expect(fit, "scoped object-fit rule must exist").toBeTruthy();
    expect(fit![1]).toContain("object-fit: cover");
    expect(fit![1]).toContain("object-position: center");
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
