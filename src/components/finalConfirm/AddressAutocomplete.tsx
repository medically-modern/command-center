import { useEffect, useRef, useState } from "react";

let mapsLoaded = false;
let mapsLoading = false;
const loadCallbacks: (() => void)[] = [];

async function loadGooglePlaces(): Promise<void> {
  if (mapsLoaded) return;

  if (mapsLoading) {
    return new Promise((resolve) => { loadCallbacks.push(resolve); });
  }

  mapsLoading = true;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) {
    console.warn("VITE_GOOGLE_MAPS_API_KEY is not set — address autocomplete disabled");
    mapsLoading = false;
    return Promise.reject(new Error("No API key"));
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.onload = () => {
      mapsLoaded = true;
      mapsLoading = false;
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks.length = 0;
      resolve();
    };
    script.onerror = () => {
      mapsLoading = false;
      reject(new Error("Google Maps JS SDK failed to load"));
    };
    document.head.appendChild(script);
  });
}

/** Strip ZIP+4 (12345-6789) down to 5-digit zip (12345) */
function stripZipPlus4(addr: string): string {
  return addr.replace(/(\b\d{5})-\d{4}\b/g, "$1");
}

/** Build a full address string from address_components, guaranteeing zip and apt are included */
function buildFullAddress(place: any): string {
  const components = place.address_components || [];
  const get = (type: string, short = false): string => {
    const c = components.find((comp: any) => comp.types.includes(type));
    if (!c) return "";
    return short ? c.short_name : c.long_name;
  };

  const streetNumber = get("street_number");
  const route = get("route");
  const subpremise = get("subpremise");
  const city = get("locality") || get("sublocality_level_1") || get("administrative_area_level_3");
  const state = get("administrative_area_level_1", true);
  const zip = get("postal_code");
  const country = get("country", true);

  let street = [streetNumber, route].filter(Boolean).join(" ");
  if (subpremise) street += ` ${subpremise}`;

  const stateZip = [state, zip].filter(Boolean).join(" ");
  const parts = [street, city, stateZip].filter(Boolean);
  let addr = parts.join(", ");
  if (country) addr += `, ${country}`;
  return stripZipPlus4(addr);
}

export interface AddressResult {
  address: string;
  lat: number;
  lng: number;
}

interface Props {
  value: string;
  onChange: (result: AddressResult) => void;
  placeholder?: string;
}

export function AddressAutocomplete({ value, onChange, placeholder }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(mapsLoaded);

  // Keep the ref current so event listeners always call the latest onChange
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Sync the input value when the value prop changes from outside (e.g. switching patients).
  // defaultValue only sets the initial value on mount — if React reuses this component
  // for a different patient, the input keeps showing the old address without this.
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (value !== prevValueRef.current && inputRef.current) {
      inputRef.current.value = value;
      prevValueRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    loadGooglePlaces()
      .then(() => setReady(true))
      .catch((err) => console.error("Failed to load Google Places:", err));
  }, []);

  useEffect(() => {
    if (!ready || !inputRef.current || autocompleteRef.current) return;
    if (!(window as any).google?.maps?.places?.Autocomplete) return;

    const autocomplete = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      types: ["address"],
      fields: ["address_components", "formatted_address", "geometry"],
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place) return;

      // Build address from components to guarantee zip and apt are included
      const components = place.address_components || [];
      let addr = "";

      if (components.length > 0) {
        addr = buildFullAddress(place);
        console.log("[AddressAutocomplete] built from components:", addr);
      } else {
        addr = stripZipPlus4(place.formatted_address || inputRef.current?.value || "");
        console.log("[AddressAutocomplete] using formatted_address:", addr);
      }

      if (!addr) return;

      // Update the input to show the full address with zip and apt
      if (inputRef.current) {
        inputRef.current.value = addr;
      }

      let lat = 0;
      let lng = 0;
      if (place.geometry?.location) {
        lat = place.geometry.location.lat();
        lng = place.geometry.location.lng();
      }

      console.log("[AddressAutocomplete] final:", addr, { lat, lng });
      onChangeRef.current({ address: addr, lat, lng });
    });

    autocompleteRef.current = autocomplete;
  }, [ready]);

  return (
    <input
      ref={inputRef}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      defaultValue={value}
      placeholder={placeholder ?? "Enter address"}
      onChange={(e) => {
        onChangeRef.current({ address: e.target.value, lat: 0, lng: 0 });
      }}
    />
  );
}
