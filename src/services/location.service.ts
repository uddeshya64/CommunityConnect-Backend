import axios from "axios";

export interface LocationSuggestion {
  mapboxId: string;
  name: string;
  address: string;
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

    return response.data.suggestions.map((item: any) => ({
      mapboxId: item.mapbox_id,
      name: item.name,
      address: item.place_formatted,
    }));
  }
}