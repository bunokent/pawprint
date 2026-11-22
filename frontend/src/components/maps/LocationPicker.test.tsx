import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationPicker, type LocationValue } from "@/components/maps/LocationPicker";
import { mswServer } from "@/test/setup";

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

/** Stateful harness — the picker is a controlled component. */
function Harness({ onChange, id = "flyer-loc", label = "Last seen location" }: { onChange: (v: LocationValue) => void; id?: string; label?: string }) {
  const [value, setValue] = useState("");
  return (
    <LocationPicker
      id={id}
      label={label}
      value={value}
      onChange={(v: LocationValue) => {
        setValue(v.address);
        onChange(v);
      }}
    />
  );
}

describe("LocationPicker", () => {
  it("falls back to a plain address input (same id) when the map cannot be created", async () => {
    state.failMap = true;
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Last seen location");
    expect(input).toHaveAttribute("id", "flyer-loc");
    expect(screen.queryByTestId("flyer-loc-map")).not.toBeInTheDocument();
    await userEvent.type(input, "Makati");
    expect(input).toHaveValue("Makati");
    expect(onChange).toHaveBeenLastCalledWith({ address: "Makati", lat: null, lng: null });
  });

  it("embeds a Leaflet map: map click and pin drag reverse-geocode the address", async () => {
    mswServer.use(
      http.get("https://nominatim.openstreetmap.org/reverse", () => HttpResponse.json({ display_name: "123 Test Street, Manila" })),
    );
    const onChange = vi.fn();
    render(<LocationPicker id="flyer-loc" label="Last seen location" value="" onChange={onChange} />);
    expect(await screen.findByTestId("flyer-loc-map")).toBeInTheDocument();
    // The address input keeps its id under the same label.
    expect(screen.getByLabelText("Last seen location")).toHaveAttribute("id", "flyer-loc");
    // CartoCDN Voyager tile layer + one draggable pin.
    expect(state.tiles[0].url).toContain("cartocdn.com");
    expect(state.markers).toHaveLength(1);
    expect(state.markers[0].opts.draggable).toBe(true);
    await waitFor(() => {
      expect((state.listeners["map:click"] ?? []).length).toBe(1);
      expect((state.listeners["marker:dragend"] ?? []).length).toBe(1);
    });

    // Simulate a map click (pin drop).
    for (const cb of state.listeners["map:click"] ?? []) cb({ latlng: { lat: 14.61, lng: 121.02 } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ address: "123 Test Street, Manila", lat: 14.61, lng: 121.02 }));
    expect(state.markers[0].latlng).toEqual({ lat: 14.61, lng: 121.02 });

    // Simulate dragging the pin to a new spot.
    state.markers[0].latlng = { lat: 14.62, lng: 121.03 };
    for (const cb of state.listeners["marker:dragend"] ?? []) cb({});
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ address: "123 Test Street, Manila", lat: 14.62, lng: 121.03 }));
  });

  it("still reports coordinates as the address when reverse geocoding fails", async () => {
    mswServer.use(http.get("https://nominatim.openstreetmap.org/reverse", () => HttpResponse.error()));
    const onChange = vi.fn();
    render(<LocationPicker id="flyer-loc" label="Last seen location" value="" onChange={onChange} />);
    await screen.findByTestId("flyer-loc-map");
    for (const cb of state.listeners["map:click"] ?? []) cb({ latlng: { lat: 14.61, lng: 121.02 } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ address: "14.61000, 121.02000", lat: 14.61, lng: 121.02 }));
  });

  it("offers Nominatim address suggestions; picking one moves the pin", async () => {
    mswServer.use(
      http.get("https://nominatim.openstreetmap.org/search", () =>
        HttpResponse.json([{ display_name: "Makati City, Metro Manila", lat: "14.5547", lon: "121.0244" }]),
      ),
    );
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await screen.findByTestId("flyer-loc-map");
    await userEvent.type(screen.getByLabelText("Last seen location"), "Makati");
    const listbox = await screen.findByRole("listbox", { name: "Address suggestions" }, { timeout: 3000 });
    expect(listbox).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("option", { name: "Makati City, Metro Manila" }));
    expect(onChange).toHaveBeenLastCalledWith({ address: "Makati City, Metro Manila", lat: 14.5547, lng: 121.0244 });
    expect(state.markers[0].latlng).toEqual({ lat: 14.5547, lng: 121.0244 });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Last seen location")).toHaveValue("Makati City, Metro Manila");
  });

  it("typing keeps the last pin coordinates", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await screen.findByTestId("flyer-loc-map");
    for (const cb of state.listeners["map:click"] ?? []) cb({ latlng: { lat: 14.61, lng: 121.02 } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 14.61, lng: 121.02 })));
    await userEvent.type(screen.getByLabelText("Last seen location"), "abc");
    // The pin drop already reverse-geocoded, so typing appends — coords are kept.
    expect(onChange).toHaveBeenLastCalledWith({ address: expect.stringContaining("abc"), lat: 14.61, lng: 121.02 });
  });
});
