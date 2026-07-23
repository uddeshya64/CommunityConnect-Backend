import { Router } from "express";
import { ProfileController } from "../controllers/profile.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// Logged in user's profile
router.get(
  "/me",
  authenticate,
  ProfileController.getMyProfile
);

// Update own profile
router.patch(
  "/me",
  authenticate,
  ProfileController.updateMyProfile
);

// Public profile by id
router.get(
  "/:id",
  authenticate,
  ProfileController.getProfileById
);

export default router;