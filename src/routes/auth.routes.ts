import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authLimiter } from '../middlewares/security'; 

const router = Router();

// POST /api/auth/email/init -> Send OTP
router.post('/registor/init', authLimiter, AuthController.initiateEmailReg);

// POST /api/auth/email/verify -> Verify & Register/Login
router.post('/registor/verify', authLimiter, AuthController.verifyEmailReg);

// POST /api/auth/login -> Email/Password Login
router.post('/login', authLimiter, AuthController.login);   

// 3. Final Step for Forgot Password
router.post('/reset-password',authLimiter, AuthController.resetPassword);

// --- Google Auth Route ---
// POST /api/auth/google -> Secure Google Login
router.post('/google', AuthController.googleLogin);

export default router;