import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { authenticate } from '../middlewares/auth.middleware'; // Your JWT check
import { authLimiter } from '../middlewares/security'; 

const router = Router();

// Apply 'authenticate' middleware to all routes in this file
// This ensures req.user.id exists
router.use(authenticate);

// GET /api/profile
router.get('/',ProfileController.getMyProfile);

// PATCH /api/profile
router.patch('/',authLimiter, ProfileController.updateMyProfile);

export default router;