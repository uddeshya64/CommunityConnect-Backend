import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import {
  EmailRegisterSchema,
  VerifyEmailOtpSchema,
  GoogleAuthSchema,
} from "../validation/auth.validation";

export const AuthController = {
  // Endpoint: POST /api/auth/email/init
  async initiateEmailReg(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      await AuthService.initiateEmailAuth(email, password);
      res.json({ success: true, message: "Verification code sent to email" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  // Endpoint: POST /api/auth/email/verify
  async verifyEmailReg(req: Request, res: Response) {
    try {
      // Validate structure
      const validatedData = VerifyEmailOtpSchema.parse(req.body);

      // Default name if not provided during login flow
      const name = validatedData.name || "User";

      const token = await AuthService.verifyEmailAndRegister({
        email: validatedData.email,
        name: name,
        otp: validatedData.otp,
      });

      res.status(201).json({ success: true, token });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Endpoint: POST /api/auth/login
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      const token = await AuthService.loginWithEmail(email, password);
      res.json({ success: true, token });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  },

  // Endpoint: POST /api/auth/google
  async googleLogin(req: Request, res: Response) {
    try {
      // ... (Same as previous Google Login implementation)
      res.json({ success: true, token: "mock_jwt_token" });
    } catch (error) {
      res.status(401).json({ error: "Google Auth Failed" });
    }
  },
};
