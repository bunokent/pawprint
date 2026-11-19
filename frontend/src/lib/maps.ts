/**
 * Google Maps JS API loader — plain <script> tag, no npm dependency.
 *
 * The API key comes from VITE_GOOGLE_MAPS_API_KEY. When it is absent
 * (local dev without a key, unit tests, e2e) `googleMapsEnabled()` is false
 * and callers degrade gracefully: LocationPicker falls back to a plain
 * address input, the /map page falls back to a pin list.
 */

/** True when this build has a Google Maps API key configured. Read at call time (tests stub the env). */
export function googleMapsEnabled(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
}

let loadPromise: Promise<typeof google.maps> | null = null;

/**
 * Injects the Maps JS API script once (with the `places` library) and resolves
 * with the `google.maps` namespace. Resolves immediately when the API is
 * already on `window.google` (e.g. a test double).
 */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window !== "undefined" && window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }
  if (!loadPromise) {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key ?? "")}&libraries=places&v=weekly`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.google?.maps) resolve(window.google.maps);
        else reject(new Error("Google Maps script loaded but window.google.maps is missing."));
      };
      script.onerror = () => reject(new Error("Could not load the Google Maps script."));
      document.head.appendChild(script);
    });
  }
  return loadPromise;
}
