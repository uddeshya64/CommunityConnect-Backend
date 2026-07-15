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

    
}