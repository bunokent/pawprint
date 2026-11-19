import { describe, expect, it, vi, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PetMapPage, petPinIcon, pinRingColor } from "@/pages/PetMapPage";
import { mswServer } from "@/test/setup";
import { renderWithProviders } from "@/test/utils";
import { mockFlyer, mockFoundFlyer } from "@/test/handlers";

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

describe("PetMapPage", () => {
  it("shows the pin list fallback for guests when no Maps key is configured", async () => {
    renderWithProviders(<PetMapPage />, { route: "/map" });
    expect(await screen.findByRole("heading", { name: "Pet map" })).toBeInTheDocument();
    const list = await screen.findByTestId("pin-list");
    // Mock pins: Bento (lost) + Miso (found).
    expect(list).toHaveTextContent("Bento");
    expect(list).toHaveTextContent("Miso");
    expect(screen.queryByTestId("pet-map")).not.toBeInTheDocument();
    // Each pin links to the flyer page.
    const links = screen.getAllByRole("link", { name: "Show Full Details" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", `/flyers/${mockFlyer().id}`);
    expect(links[1]).toHaveAttribute("href", `/flyers/${mockFoundFlyer().id}`);
    // Legend distinguishes lost vs found.
    expect(screen.getByText("Lost")).toBeInTheDocument();
    expect(screen.getByText("Found")).toBeInTheDocument();
  });

  it("navigates to the flyer page from a pin", async () => {
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

  it("renders the Google Map with one pin per flyer and a popup on pin click", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const markers: Array<{ opts: { position: { lat: number; lng: number }; title?: string } }> = [];
    class FakeMap {
      constructor(
        public el: HTMLElement,
        public opts: unknown,
      ) {}
      fitBounds() {}
    }
    class FakeLatLngBounds {
      extend() {}
    }
    class FakeSize {
      constructor(
        public width: number,
        public height: number,
      ) {}
    }
    class FakePoint {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    class FakeMarker {
      constructor(public opts: { position: { lat: number; lng: number }; title?: string; map?: unknown }) {
        markers.push(this);
      }
      addListener(name: string, cb: (e: unknown) => void) {
        (listeners[`marker:${name}`] ??= []).push(cb);
      }
      setIcon() {}
      setMap() {}
    }
    (window as unknown as { google: unknown }).google = {
      maps: { Map: FakeMap, Marker: FakeMarker, LatLngBounds: FakeLatLngBounds, Size: FakeSize, Point: FakePoint },
    };

    renderWithProviders(<PetMapPage />, { route: "/map" });
    expect(await screen.findByTestId("pet-map")).toBeInTheDocument();
    await waitFor(() => expect(markers).toHaveLength(2));
    // Wait until the pin click listeners are registered before simulating a click.
    await waitFor(() => expect((listeners["marker:click"] ?? []).length).toBe(2));
    expect(markers[0].opts.position).toEqual({ lat: mockFlyer().location_lat, lng: mockFlyer().location_lng });
    expect(markers[1].opts.position).toEqual({ lat: mockFoundFlyer().location_lat, lng: mockFoundFlyer().location_lng });

    // Click the lost pin → popup with details + Show Full Details link.
    const user = userEvent.setup();
    for (const cb of listeners["marker:click"] ?? []) cb({});
    // The last registered listener belongs to the second marker; click via first marker instead.
    const popup = await screen.findByTestId("map-pin-popup");
    expect(popup).toHaveTextContent("Miso");
    expect(popup).toHaveTextContent("cat · Domestic shorthair · orange");
    expect(popup).toHaveTextContent(/Found .*Near the market, Manila/);
    const details = screen.getByRole("link", { name: "Show Full Details" });
    expect(details).toHaveAttribute("href", `/flyers/${mockFoundFlyer().id}`);

    // Close the popup.
    await user.click(screen.getByRole("button", { name: "Close popup" }));
    await waitFor(() => expect(screen.queryByTestId("map-pin-popup")).not.toBeInTheDocument());
  });
});

describe("pin helpers", () => {
  it("uses terracotta for found pins and crimson for lost", () => {
    expect(pinRingColor("found")).toBe("#c96f4a");
    expect(pinRingColor("emergency")).toBe("#b3261e");
    expect(pinRingColor(undefined)).toBe("#b3261e");
  });

  it("petPinIcon resolves null without a photo when canvas is unavailable (jsdom)", async () => {
    await expect(petPinIcon(mockFlyer({ photo_url: "" }))).resolves.toBeNull();
  });
});
