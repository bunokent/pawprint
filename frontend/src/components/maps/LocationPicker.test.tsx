import { useState } from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationPicker, type LocationValue } from "@/components/maps/LocationPicker";

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

/** Minimal fake of the google.maps surface LocationPicker uses, recording listeners. */
function installFakeGoogle() {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  class FakeLatLng {
    constructor(
      private readonly la: number,
      private readonly ln: number,
    ) {}
    lat() {
      return this.la;
    }
    lng() {
      return this.ln;
    }
  }
  class FakeMap {
    constructor(
      public el: HTMLElement,
      public opts: unknown,
    ) {}
    addListener(name: string, cb: (e: unknown) => void) {
      (listeners[`map:${name}`] ??= []).push(cb);
    }
    panTo() {}
  }
  class FakeMarker {
    constructor(public opts: unknown) {}
    addListener(name: string, cb: (e: unknown) => void) {
      (listeners[`marker:${name}`] ??= []).push(cb);
    }
    setPosition() {}
    setMap() {}
  }
  class FakeGeocoder {
    geocode(_req: unknown, cb: (results: unknown, status: string) => void) {
      cb([{ formatted_address: "123 Test Street, Manila" }], "OK");
    }
  }
  class FakeAutocomplete {
    constructor(public input: HTMLInputElement) {}
    addListener(name: string, cb: (e: unknown) => void) {
      (listeners[`ac:${name}`] ??= []).push(cb);
    }
    getPlace() {
      return {};
    }
  }
  (window as unknown as { google: unknown }).google = {
    maps: {
      Map: FakeMap,
      Marker: FakeMarker,
      Geocoder: FakeGeocoder,
      LatLng: FakeLatLng,
      places: { Autocomplete: FakeAutocomplete },
    },
  };
  return { listeners, FakeLatLng };
}

describe("LocationPicker", () => {
  it("falls back to a plain address input (same id) when no Maps key is configured", async () => {
    const onChange = vi.fn();
    // Stateful harness — the picker is a controlled component.
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <LocationPicker
          id="flyer-loc"
          label="Last seen location"
          value={value}
          onChange={(v: LocationValue) => {
            setValue(v.address);
            onChange(v);
          }}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Last seen location");
    expect(input).toHaveAttribute("id", "flyer-loc");
    expect(screen.queryByTestId("flyer-loc-map")).not.toBeInTheDocument();
    await userEvent.type(input, "Makati");
    expect(input).toHaveValue("Makati");
    expect(onChange).toHaveBeenLastCalledWith({ address: "Makati", lat: null, lng: null });
  });

  it("embeds the map when a key is set: dropping/dragging the pin reverse-geocodes the address", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    const { listeners, FakeLatLng } = installFakeGoogle();

    const onChange = vi.fn();
    render(<LocationPicker id="flyer-loc" label="Last seen location" value="" onChange={onChange} />);
    expect(await screen.findByTestId("flyer-loc-map")).toBeInTheDocument();
    // Autocomplete input is wired under the same id.
    expect(screen.getByLabelText("Last seen location")).toHaveAttribute("id", "flyer-loc");
    // Wait until the map + marker listeners are registered.
    await waitFor(() => {
      expect((listeners["map:click"] ?? []).length).toBe(1);
      expect((listeners["marker:dragend"] ?? []).length).toBe(1);
      expect((listeners["ac:place_changed"] ?? []).length).toBe(1);
    });

    // Simulate a map click (pin drop).
    for (const cb of listeners["map:click"] ?? []) cb({ latLng: new FakeLatLng(14.61, 121.02) });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ address: "123 Test Street, Manila", lat: 14.61, lng: 121.02 }));

    // Simulate dragging the pin to a new spot.
    for (const cb of listeners["marker:dragend"] ?? []) cb({ latLng: new FakeLatLng(14.62, 121.03) });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ address: "123 Test Street, Manila", lat: 14.62, lng: 121.03 }));
  });
});
