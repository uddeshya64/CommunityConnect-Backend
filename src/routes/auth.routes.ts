import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authLimiter } from "../middlewares/security";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// ---------------- Registration ----------------

router.post(
  "/register/init",
  authLimiter,
  AuthController.initiateEmailReg
);

router.post(
  "/register/verify",
  authLimiter,
  AuthController.verifyEmailReg
);

// ---------------- Login ----------------

router.post(
  "/login",
  authLimiter,
  AuthController.login
);

// ---------------- Refresh Token ----------------

router.post(
  "/refresh",
  AuthController.refresh
);

// ---------------- Logout ----------------

router.post(
  "/logout",
  authenticate,
  AuthController.logout
);

// ---------------- Logout All Devices ----------------

router.post(
  "/logout-all",
  authenticate,
  AuthController.logoutAll
);

// ---------------- Reset Password ----------------

router.post(
  "/reset-password",
  authLimiter,
  AuthController.resetPassword
);

// ---------------- Google Login ----------------

router.post(
  "/google",
  AuthController.googleLogin
);

export default router;