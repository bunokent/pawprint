/**
 * Minimal ambient typings for the Google Maps JavaScript API.
 *
 * The API is loaded at runtime through a plain <script> tag (see src/lib/maps.ts),
 * so there is no npm dependency — these declarations cover only the surface
 * PawPrint actually uses (map, draggable marker, geocoder, places autocomplete,
 * canvas-drawn photo pins).
 */
declare namespace google {
  namespace maps {
    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    class LatLng {
      constructor(lat: number, lng: number);
      lat(): number;
      lng(): number;
      toJSON(): LatLngLiteral;
    }

    class Point {
      constructor(x: number, y: number);
      x: number;
      y: number;
    }

    class Size {
      constructor(width: number, height: number);
      width: number;
      height: number;
    }

    class LatLngBounds {
      constructor(sw?: LatLngLiteral | LatLng, ne?: LatLngLiteral | LatLng);
      extend(point: LatLngLiteral | LatLng): LatLngBounds;
    }

    interface MapsEventListener {
      remove(): void;
    }

    interface MapMouseEvent {
      latLng: LatLng | null;
    }

    interface MapOptions {
      center: LatLngLiteral | LatLng;
      zoom: number;
      mapId?: string;
      disableDefaultUI?: boolean;
      clickableIcons?: boolean;
      gestureHandling?: string;
    }

    class Map {
      constructor(mapDiv: HTMLElement, opts: MapOptions);
      setCenter(latlng: LatLngLiteral | LatLng): void;
      panTo(latlng: LatLngLiteral | LatLng): void;
      fitBounds(bounds: LatLngBounds): void;
      getZoom(): number | undefined;
      addListener(eventName: string, handler: (event: MapMouseEvent) => void): MapsEventListener;
    }

    interface Icon {
      url: string;
      size?: Size;
      scaledSize?: Size;
      anchor?: Point;
      origin?: Point;
    }

    interface MarkerOptions {
      position: LatLngLiteral | LatLng;
      map?: Map | null;
      title?: string;
      draggable?: boolean;
      icon?: string | Icon;
    }

    class Marker {
      constructor(opts: MarkerOptions);
      setPosition(latlng: LatLngLiteral | LatLng): void;
      getPosition(): LatLng | null | undefined;
      setMap(map: Map | null): void;
      setIcon(icon: string | Icon): void;
      addListener(eventName: string, handler: (event: MapMouseEvent) => void): MapsEventListener;
    }

    interface GeocoderRequest {
      location?: LatLngLiteral | LatLng;
      address?: string;
    }

    interface GeocoderResult {
      formatted_address: string;
      geometry?: { location?: LatLng };
    }

    class Geocoder {
      geocode(request: GeocoderRequest, callback: (results: GeocoderResult[] | null, status: string) => void): void;
    }

    namespace places {
      interface PlaceResult {
        formatted_address?: string;
        name?: string;
        geometry?: { location?: LatLng | null };
      }

      interface AutocompleteOptions {
        fields?: string[];
        types?: string[];
      }

      class Autocomplete {
        constructor(inputField: HTMLInputElement, opts?: AutocompleteOptions);
        getPlace(): PlaceResult;
        addListener(eventName: string, handler: () => void): MapsEventListener;
      }
    }
  }
}

interface Window {
  google?: typeof google;
}
