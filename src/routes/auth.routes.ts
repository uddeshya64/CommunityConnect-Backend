import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authLimiter } from '../middlewares/security'; // The rate limiter we made earlier

const router = Router();

// --- Email OTP Routes ---
// POST /api/auth/email/init -> Send OTP
router.post('/email/init', authLimiter, AuthController.initiateEmailReg);

// POST /api/auth/email/verify -> Verify & Register/Login
router.post('/email/verify', authLimiter, AuthController.verifyEmailReg);

// --- Google Auth Route ---
// POST /api/auth/google -> Secure Google Login
router.post('/google', AuthController.googleLogin);

export default router;