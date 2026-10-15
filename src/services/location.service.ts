import axios from "axios";

export interface LocationSuggestion {
  mapboxId: string;
  name: string;
  address: string;
}

export interface ReverseGeocodeResult {
  name: string;
  address: string;
  fullAddress: string;
  city?: string;
  state?: string;
  country?: string;
}

export class LocationService {
  static async searchLocations(
    query: string
  ): Promise<LocationSuggestion[]> {
    const response = await axios.get(
      "https://api.mapbox.com/search/searchbox/v1/suggest",
      {
        params: {
          q: query,
          language: "en",
          limit: 5,
          session_token: "community-connect-session",
          access_token: process.env.MAPBOX_ACCESS_TOKEN,
        },
      }
    );

    return (response.data.suggestions || []).map((item: any) => ({
      mapboxId: item.mapbox_id,
      name: item.name,
      address: item.place_formatted,
    }));
  }

  static async reverseGeocode(
    lat: number,
    lng: number
  ): Promise<ReverseGeocodeResult> {
    try {
      const response = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`,
        {
          params: {
            access_token: process.env.MAPBOX_ACCESS_TOKEN,
            types: "poi,address,neighborhood,locality,place",
          },
        }
      );

      const features = response.data?.features || [];
      if (features.length > 0) {
        const primary = features[0];
        const placeName = primary.place_name || "";
        const name = primary.text || primary.place_name || "Detected Location";

        let city = "";
        let state = "";
        let country = "";

        if (Array.isArray(primary.context)) {
          for (const ctx of primary.context) {
            const id = (ctx.id || "") as string;
            if (id.startsWith("place")) city = ctx.text;
            if (id.startsWith("region")) state = ctx.text;
            if (id.startsWith("country")) country = ctx.text;
          }
        }

        return {
          name,
          address: placeName,
          fullAddress: placeName,
          city,
          state,
          country,
        };
      }
    } catch (err: any) {
      console.warn("[LOCATION_SERVICE] Mapbox reverse geocode failed:", err?.message || err);
    }

    // Fallback if Mapbox doesn't return features or fails
    return {
      name: `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      fullAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    };
  }
}