import { Request, Response, NextFunction } from 'express';

/**
 * requireTenantOwner Middleware
 * Verifies that the authenticated user matches the organizerId specified in the request.
 * Since the "Tenant" is the event organizer (User), only the organizer themselves
 * is allowed to view or edit their global tenant configurations.
 */
export const requireTenantOwner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: Please log in." });
    }

    const organizerId = Number(req.params.organizerId || req.body.organizerId);
    if (!organizerId) {
      return res.status(400).json({ error: "Organizer ID is required for this request." });
    }

    // Tenant is the event creator/organizer. The organizer can only manage their own configuration.
    if (userId !== organizerId) {
      return res.status(403).json({ error: "Access denied: You are not authorized to manage this organizer's configuration." });
    }

    next();
  } catch (error) {
    console.error("Tenant Owner Middleware Error:", error);
    res.status(500).json({ error: "Internal server error during configuration verification." });
  }
};
