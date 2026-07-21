import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import {
  VerifyEmailOtpSchema,
  SendOtpSchema,
  ResetPasswordSchema,
} from "../validation/auth.validation";
import { SessionService } from "../services/session.service";

export const AuthController = {

  // POST /api/auth/email/init
  async initiateEmailReg(req: Request, res: Response) {
    try {
      const {
        email,
        password,
        context = "REGISTER",
      } = SendOtpSchema.parse(req.body);

      if (context === "REGISTER" && !password) {
        return res.status(400).json({
          success: false,
          error: "Password is required for registration",
        });
      }

      await AuthService.sendOtp(
        email,
        password,
        context
      );

      return res.status(200).json({
        success: true,
        message: "Verification code sent to email",
      });

    } catch (error: any) {

      const statusCode =
        error.name === "ZodError"
          ? 400
          : 500;

      return res.status(statusCode).json({
        success: false,
        error: error.message,
      });

    }
  },

  // POST /api/auth/email/verify
  async verifyEmailReg(
    req: Request,
    res: Response
  ) {

    try {

      const validatedData =
        VerifyEmailOtpSchema.parse(req.body);

      // Registration Flow
      if (validatedData.context === "REGISTER") {

        const tokens =
          await AuthService.verifyRegisterOtp(
            validatedData.name || "User",
            validatedData.email,
            validatedData.otp
          );

        return res.status(201).json({
          success: true,
          ...tokens,
          message: "Registration successful",
        });
      }

      // Password Reset Flow
      const resetToken =
        await AuthService.verifyResetOtp(
          validatedData.email,
          validatedData.otp
        );

      return res.status(200).json({
        success: true,
        token: resetToken,
        message: "OTP verified",
      });

    } catch (error: any) {

      return res.status(400).json({
        success: false,
        error: error.message,
      });

    }
  },

  // POST /api/auth/reset-password
  async resetPassword(
    req: Request,
    res: Response
  ) {

    try {

      const {
        token,
        newPassword,
      } = ResetPasswordSchema.parse(req.body);

      await AuthService.resetPassword(
        token,
        newPassword
      );

      return res.json({
        success: true,
        message: "Password updated successfully. Please login.",
      });

    } catch (error: any) {

      return res.status(400).json({
        success: false,
        error: error.message,
      });

    }
  },

  // POST /api/auth/login
  async login(
    req: Request,
    res: Response
  ) {

    try {

      const {
        email,
        password,
      } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: "Email and password are required",
        });
      }

      const tokens =
        await AuthService.loginWithEmail(
          email,
          password
        );

      return res.status(200).json({
        success: true,
        ...tokens,
      });

    } catch (error: any) {

      return res.status(401).json({
        success: false,
        error: error.message,
      });

    }
  },

  // POST /api/auth/google
  async googleLogin(
    req: Request,
    res: Response
  ) {

    try {

      // Replace with actual Google OAuth flow
      return res.status(501).json({
        success: false,
        message: "Google login not implemented yet.",
      });

    } catch (error: any) {

      return res.status(401).json({
        success: false,
        error: "Google authentication failed",
      });

    }
  },

  // POST /api/auth/refresh
async refresh(
  req: Request,
  res: Response
) {
  try {

    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: "Refresh token is required",
      });
    }

    const token =
      await SessionService.refreshSession(
        refreshToken
      );

    return res.status(200).json({
      success: true,
      ...token,
    });

  } catch (error: any) {

    return res.status(401).json({
      success: false,
      error: error.message,
    });

  }
},

// POST /api/auth/logout
async logout(
  req: Request,
  res: Response
) {

  try {

    await SessionService.logout(
    req.user.sessionId
    );

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });

  } catch (error: any) {

    return res.status(400).json({
      success: false,
      error: error.message,
    });

  }
},

// POST /api/auth/logout-all
async logoutAll(
  req: Request,
  res: Response
) {

  try {

    
    await SessionService.logoutAll(
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: "Logged out from all devices",
    });

  } catch (error: any) {

    return res.status(400).json({
      success: false,
      error: error.message,
    });

  }
},

};