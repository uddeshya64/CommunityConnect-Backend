import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import {
  // EmailRegisterSchema,
  VerifyEmailOtpSchema,
  // GoogleAuthSchema,
  SendOtpSchema,
  ResetPasswordSchema
} from "../validation/auth.validation";

export const AuthController = {
  // Endpoint: POST /api/auth/email/init
  async initiateEmailReg(req: Request, res: Response) {
      try {
        // 1. Parse the body using your Zod Schema
        const { email, password, context = "REGISTER" } = SendOtpSchema.parse(req.body);

        // 2. Logic Check: If registering, password MUST be present
        if (context === "REGISTER" && !password) {
          return res.status(400).json({ 
            success: false, 
            error: "Password is required for registration" 
          });
        }

        // 3. Call the Service
        // Password will be passed as undefined if it's a RESET, which is fine now!
        await AuthService.sendOtp(email, password, context);

        return res.status(200).json({ 
          success: true, 
          message: "Verification code sent to email" 
        });

      } catch (error: any) {
        // If Zod validation fails, it throws an error that ends up here
        const statusCode = error.name === 'ZodError' ? 400 : 500;
        
        return res.status(statusCode).json({ 
          success: false, 
          error: error.message 
        });
      }
    },
  // Endpoint: POST /api/auth/email/verify
  async verifyEmailReg(req: Request, res: Response) {
    try {
      // Validate structure
      const validatedData = VerifyEmailOtpSchema.parse(req.body);

      // Default name if not provided during login flow
      const name = validatedData.name || "User";

      const token = await AuthService.verifyOtp(
        name,
        validatedData.email,
        validatedData.otp,
        validatedData.context
      );

      res.status(201).json({ success: true, token, message: "verified" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // Endpoint: POST /api/auth/reset-password
  async resetPassword(req: Request, res: Response) {
    try {
      const { token, newPassword } = ResetPasswordSchema.parse(req.body);
      
      await AuthService.resetPassword(token, newPassword);
      
      res.json({ success: true, message: "Password updated. Please login." });
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
