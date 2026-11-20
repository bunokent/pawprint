import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PetMapPage } from "@/pages/PetMapPage";
import { mswServer } from "@/test/setup";
import { renderWithProviders } from "@/test/utils";
import { mockFlyer, mockFoundFlyer, mockPet } from "@/test/handlers";
import { petPinIcon, pinRingColor } from "@/lib/maps";

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

describe("PetMapPage", () => {
  it("renders the Leaflet map with one photo pin per flyer and a popup on pin click", async () => {
    renderWithProviders(<PetMapPage />, { route: "/map" });
    expect(await screen.findByRole("heading", { name: "Pet map" })).toBeInTheDocument();
    expect(await screen.findByTestId("pet-map")).toBeInTheDocument();
    // Map mode: no list fallback.
    expect(screen.queryByTestId("pin-list")).not.toBeInTheDocument();
    // OSM tile layer on the map container.
    expect(state.tiles[0].url).toContain("tile.openstreetmap.org");
    expect(state.maps[0].opts.center).toEqual([mockFlyer().location_lat, mockFlyer().location_lng]);

    await waitFor(() => expect(state.markers).toHaveLength(2));
    await waitFor(() => expect((state.listeners["marker:click"] ?? []).length).toBe(2));
    expect(state.markers[0].latlng).toEqual({ lat: mockFlyer().location_lat, lng: mockFlyer().location_lng });
    expect(state.markers[1].latlng).toEqual({ lat: mockFoundFlyer().location_lat, lng: mockFoundFlyer().location_lng });
    // Photo pins carry the status ring: red lost, green found.
    expect(state.markers[0].opts.icon.opts.html).toContain("border-color:#b3261e");
    expect(state.markers[0].opts.icon.opts.html).toContain('alt="Bento"');
    expect(state.markers[1].opts.icon.opts.html).toContain("border-color:#2e9e63");
    expect(state.markers[1].opts.icon.opts.html).toContain('alt="Miso"');

    // Click the found pin (second marker) → popup with details + Show Full Details link.
    const user = userEvent.setup();
    (state.listeners["marker:click"] ?? [])[1]({});
    const popup = await screen.findByTestId("map-pin-popup");
    expect(popup).toHaveTextContent("Miso");
    expect(popup).toHaveTextContent("cat · Domestic shorthair · orange");
    expect(popup).toHaveTextContent(/Found .*Near the market, Manila/);
    expect(screen.getByRole("link", { name: "Show Full Details" })).toHaveAttribute("href", `/flyers/${mockFoundFlyer().id}`);

    // Close the popup.
    await user.click(screen.getByRole("button", { name: "Close popup" }));
    await waitFor(() => expect(screen.queryByTestId("map-pin-popup")).not.toBeInTheDocument());
  });

  it("falls back to the pin list when the map cannot be created", async () => {
    state.failMap = true;
    renderWithProviders(<PetMapPage />, { route: "/map" });
    const list = await screen.findByTestId("pin-list");
    expect(screen.queryByTestId("pet-map")).not.toBeInTheDocument();
    expect(screen.getByText(/could not load/)).toBeInTheDocument();
    // Mock pins: Bento (lost) + Miso (found).
    expect(list).toHaveTextContent("Bento");
    expect(list).toHaveTextContent("Miso");
    const links = screen.getAllByRole("link", { name: "Show Full Details" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", `/flyers/${mockFlyer().id}`);
    expect(links[1]).toHaveAttribute("href", `/flyers/${mockFoundFlyer().id}`);
    // Legend distinguishes lost vs found pin colours.
    const legend = screen.getByLabelText("Pin legend");
    expect(legend).toHaveTextContent("Lost — red pin");
    expect(legend).toHaveTextContent("Found — green pin");
  });

  it("marks vision-matched pins with the amber halo and shows a match banner in the popup", async () => {
    const lost = mockFlyer();
    const found = mockFoundFlyer({
      match: { flyer_id: lost.id, mode: "emergency", pet_name: lost.pet.name ?? "Bento", score: 0.92 },
    });
    mswServer.use(http.get("*/api/flyers/map", () => HttpResponse.json([lost, found])));
    renderWithProviders(<PetMapPage />, { route: "/map" });
    await waitFor(() => expect(state.markers).toHaveLength(2));
    // The matched pin gets the halo class on the marker; the unmatched one does not.
    expect(state.markers[1].opts.icon.opts.className).toContain("pp-pin--match");
    expect(state.markers[0].opts.icon.opts.className).not.toContain("pp-pin--match");
    // Legend shows the "Possible match" badge.
    expect(screen.getByText(/Possible match/)).toBeInTheDocument();
    // Popup of the matched pin shows the banner linking to the counterpart flyer.
    (state.listeners["marker:click"] ?? [])[1]({});
    const popup = await screen.findByTestId("map-pin-popup");
    const banner = await screen.findByTestId("pin-match-banner");
    expect(banner).toHaveTextContent("Possible photo match with Bento (92%)");
    expect(banner.querySelector("a")).toHaveAttribute("href", `/flyers/${lost.id}`);
    expect(popup).toHaveTextContent("Miso");
  });

  it("stacks pins at the same spot into one deck pin with a ×N badge; tapping it lists every stacked flyer", async () => {
    const spot = { location_lat: 14.5995, location_lng: 120.9842 };
    const lost = mockFlyer({ ...spot, created_at: "2026-11-10T00:00:00Z" }); // oldest → peeks behind
    const found = mockFoundFlyer({ ...spot, created_at: "2026-11-12T00:00:00Z", pet: mockPet({ name: "", status: "found" }) }); // newest → top card
    mswServer.use(http.get("*/api/flyers/map", () => HttpResponse.json([lost, found])));
    renderWithProviders(<PetMapPage />, { route: "/map" });

    // One marker only, rendered as a stack with a count badge.
    await waitFor(() => expect(state.markers).toHaveLength(1));
    const icon = state.markers[0].opts.icon.opts;
    expect(icon.className).toContain("pp-stack-pin");
    expect(icon.html).toContain('data-stack-count="2"');
    // Top card keeps the found (green) ring; the back card keeps the lost (red) ring.
    expect(icon.html).toContain('data-stack-top="true"');
    expect(icon.html).toContain('data-pet-name="Found pet"');
    expect(icon.html).toContain("border-color:#2e9e63");
    expect(icon.html).toContain("pp-stack__card");
    expect(icon.html).toContain("border-color:#b3261e");

    // Tap the stack → popup lists both stacked flyers with links.
    (state.listeners["marker:click"] ?? [])[0]({});
    const popup = await screen.findByTestId("map-pin-popup");
    expect(within(popup).getByTestId("stack-count-badge")).toHaveTextContent("×2");
    const cards = popup.querySelectorAll('[data-testid="stack-card"]');
    expect(cards).toHaveLength(2);
    expect(popup).toHaveTextContent("Found pet"); // unnamed found pet fallback
    expect(popup).toHaveTextContent("Bento");
    const openLinks = popup.querySelectorAll('a[href^="/flyers/"]');
    expect([...openLinks].map((a) => a.getAttribute("href"))).toEqual([`/flyers/${found.id}`, `/flyers/${lost.id}`]);
  });

  it("navigates to the flyer page from a pin (list fallback)", async () => {
    state.failMap = true;
    const user = userEvent.setup();
    renderWithProviders(<PetMapPage />, {
      route: "/map",
      routes: [["/flyers/:id", <div>FLYER DETAIL</div>]],
    });
    await screen.findByTestId("pin-list");
    await user.click(screen.getAllByRole("link", { name: "Show Full Details" })[0]);
    expect(await screen.findByText("FLYER DETAIL")).toBeInTheDocument();
  });

  it("shows the empty state when there are no pins", async () => {
    mswServer.use(http.get("*/api/flyers/map", () => HttpResponse.json([])));
    renderWithProviders(<PetMapPage />, { route: "/map" });
    expect(await screen.findByText("No pinned pets yet")).toBeInTheDocument();
  });

  it("shows an error when the map endpoint fails", async () => {
    mswServer.use(http.get("*/api/flyers/map", () => HttpResponse.error()));
    renderWithProviders(<PetMapPage />, { route: "/map" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the pet map");
  });
});

describe("pin helpers", () => {
  it("uses green for found pins and red for lost", () => {
    expect(pinRingColor("found")).toBe("#2e9e63");
    expect(pinRingColor("emergency")).toBe("#b3261e");
    expect(pinRingColor(undefined)).toBe("#b3261e");
  });

  it("petPinIcon renders the photo with a ring, or the initial without one", () => {
    const withPhoto = petPinIcon(mockFlyer()) as unknown as { opts: { html: string } };
    expect(withPhoto.opts.html).toContain(`src="${mockFlyer().photo_url}"`);
    expect(withPhoto.opts.html).toContain('alt="Bento"');
    const noPhoto = petPinIcon(mockFoundFlyer({ photo_url: "" })) as unknown as { opts: { html: string } };
    expect(noPhoto.opts.html).toContain("pp-pin__letter");
    expect(noPhoto.opts.html).toContain(">M</span>");
  });
});
