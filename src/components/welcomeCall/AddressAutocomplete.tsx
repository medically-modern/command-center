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
    return;
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

/** Build a full address string from address_components, guaranteeing zip is included */
function buildFullAddress(place: google.maps.places.PlaceResult): string {
  const components = place.address_components || [];
  const get = (type: string) => components.find((c) => c.types.includes(type))?.long_name || "";

  const streetNumber = get("street_number");
  const route = get("route");
  const city = get("locality") || get("sublocality_level_1") || get("administrative_area_level_3");
  const state = components.find((c) => c.types.includes("administrative_area_level_1"))?.short_name || "";
  const zip = get("postal_code");
  const country = components.find((c) => c.types.includes("country"))?.short_name || "";

  const street = [streetNumber, route].filter(Boolean).join(" ");
  const parts = [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean);
  let addr = parts.join(", ");
  if (country) addr += `, ${country}`;
  return addr;
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
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(mapsLoaded);

  // Keep the ref current so event listeners always call the latest onChange
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    loadGooglePlaces()
      .then(() => setReady(true))
      .catch((err) => console.error("Failed to load Google Places:", err));
  }, []);

  useEffect(() => {
    if (!ready || !inputRef.current || autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      types: ["address"],
      fields: ["address_components", "formatted_address", "geometry"],
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place) return;

      // Build address from components to guarantee zip is included
      const components = place.address_components || [];
      let addr = "";

      if (components.length > 0) {
        addr = buildFullAddress(place);
        console.log("[AddressAutocomplete] built from components:", addr);
      } else {
        addr = place.formatted_address || inputRef.current?.value || "";
        console.log("[AddressAutocomplete] using formatted_address:", addr);
      }

      if (!addr) return;

      // Update the input to show the full address with zip
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
    />
  );
}
