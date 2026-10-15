import { Request, Response } from "express";
import { LocationService } from "../services/location.service";

export class LocationController {

    // Search locations
    static async search(req: Request, res: Response) {
        try {
            const query = req.query.q as string;

            if (!query || query.trim().length < 3) {
                return res.status(400).json({
                    success: false,
                    message: "Search query must contain at least 3 characters.",
                });
            }

            const locations = await LocationService.searchLocations(query);

            return res.status(200).json({
                success: true,
                data: locations,
            });

        } catch (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                message: "Failed to fetch locations.",
            });
        }
    }

    // Reverse geocode accurate GPS coordinates (lat, lng) to real address
    static async reverse(req: Request, res: Response) {
        try {
            const latStr = req.query.lat as string;
            const lngStr = req.query.lng as string;

            const lat = Number(latStr);
            const lng = Number(lngStr);

            if (Number.isNaN(lat) || Number.isNaN(lng)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid 'lat' and 'lng' numeric query parameters are required.",
                });
            }

            const location = await LocationService.reverseGeocode(lat, lng);

            return res.status(200).json({
                success: true,
                data: location,
            });
        } catch (error) {
            console.error("[LOCATION_CONTROLLER] Reverse geocode error:", error);

            return res.status(500).json({
                success: false,
                message: "Failed to resolve coordinates to location.",
            });
        }
    }
}