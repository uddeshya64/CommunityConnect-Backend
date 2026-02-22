import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { EventPermission } from '../utils/constants/permissions';

const prisma = new PrismaClient();

export const requirePermission = (requiredPermission: EventPermission) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Ensure the user is authenticated (relies on your auth.middleware running first)
      const userId = req.user?.id; 
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized: Please log in." });
      }

      // 2. Extract the Event ID from the URL parameters or the request body
      const eventId = Number(req.params.eventId || req.body.eventId);
      if (!eventId) {
        return res.status(400).json({ error: "Event ID is required to check permissions." });
      }

      // 3. Check God Mode (Is this user the absolute creator of the event?)
      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return res.status(404).json({ error: "Event not found." });
      }
      
      if (event.created_by === userId) {
        return next(); // The Creator bypasses all permission checks
      }

      // 4. Fetch the User's Staff Contract for this specific event
      const staffRecord = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true } // We MUST include the role to read the permissions array
      });

      if (!staffRecord) {
        return res.status(403).json({ error: "Access denied. You are not staff for this event." });
      }

      // 5. Extract permissions from the base Role Definition AND any user-specific overrides
      const rolePermissions = (staffRecord.role.permissions as string[]) || [];
      const userOverrides = (staffRecord.permissions_override as string[]) || [];

      // 6. Check if they have the specific atomic permission required for this route
      if (rolePermissions.includes(requiredPermission) || userOverrides.includes(requiredPermission)) {
        return next(); // Access Granted! Proceed to the Controller.
      }

      // 7. If they don't have it, block them.
      return res.status(403).json({ 
        error: `Access denied. You lack the required permission: '${requiredPermission}'` 
      });

    } catch (error) {
      console.error("Permission Check Error:", error);
      res.status(500).json({ error: "Internal server error during permission verification." });
    }
  };
};