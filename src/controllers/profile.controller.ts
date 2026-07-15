import { Request, Response } from 'express';
import { ProfileService } from '../services/profile.service';
import { UpdateProfileSchema } from '../validation/profile.validation';

// Helper to get User ID from the Request (attached by auth middleware)
// Assuming req.user was populated by your verifyToken middleware
const getUserId = (req: Request) => {
  if (!req.user || !req.user.id) throw new Error("Unauthorized");
  return Number(req.user.id); // Ensure it's a number for Prisma 
};

export const ProfileController = {

  // GET /api/profile
  async getMyProfile(req: Request, res: Response) {
    try {
      const userId = getUserId(req);
      const profile = await ProfileService.getProfile(userId);
      res.json({ success: true, data: profile });
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  },

  // GET /api/profile/:id
  // (NEW: Allows any authenticated user to see any other profile)
  async getProfileById(req: Request, res: Response) {
    try {
      // Get the ID from the URL params instead of the token
      const targetUserId = Number(req.params.id);
      
      if (isNaN(targetUserId)) {
        return res.status(400).json({ error: "Invalid User ID format" });
      }

      const profile = await ProfileService.getProfile(targetUserId);
      res.json({ success: true, data: profile });
    } catch (error: any) {
      res.status(404).json({ error: "Profile not found" });
    }
  },

  // PATCH /api/profile
  async updateMyProfile(req: Request, res: Response) {
    try {
      const userId = getUserId(req);
      
      // 1. Validate Input
      const validatedData = UpdateProfileSchema.parse(req.body);

      // 2. Call Service
      const updatedProfile = await ProfileService.updateProfile(userId, validatedData);

      res.json({ success: true, message: "Profile updated", data: updatedProfile });
    } catch (error: any) {
      if (error.issues) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(500).json({ error: error.message });
    }
  }
};