import { Router } from 'express';
import { TeamController } from '../controllers/team.controller';
import { authLimiter } from '../middlewares/security';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Unified endpoint for both Team and Individual registration 
router.post('/start', authLimiter, TeamController.startRegistration);

// Unified endpoint for payment verification [cite: 14, 16]
router.post('/verify', authLimiter, TeamController.verifyPayment);

export default router;