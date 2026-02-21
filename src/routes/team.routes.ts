import { Router } from 'express';
import { TeamController } from '../controllers/team.controller';
import { authLimiter } from '../middlewares/security';

const router = Router();

// POST /api/teams/register
router.post('/register', authLimiter, TeamController.startRegistration);

// POST /api/payments/verify
router.post('/register/verify', authLimiter, TeamController.verifyPayment);

export default router;