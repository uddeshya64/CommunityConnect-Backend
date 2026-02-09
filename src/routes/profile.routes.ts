import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { authenticate } from '../middlewares/auth.middleware'; // Your JWT check
import { authLimiter } from '../middlewares/security'; 

const router = Router();

// Apply 'authenticate' middleware to all routes in this file
// This ensures req.user.id exists
router.use(authenticate);

// 1. Fetch current user's profile
router.get('/', ProfileController.getMyProfile);

// 2. Update current user's profile
router.patch('/', ProfileController.updateMyProfile);

export default router;