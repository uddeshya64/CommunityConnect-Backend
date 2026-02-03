import { z } from 'zod';

// Schema for initiating EMAIL registration
export const EmailRegisterSchema = z.object({
  email: z.string().email("Invalid email format"),
  name: z.string().min(2, "Name must be at least 2 chars"),
});

// Schema for verifying OTP
export const VerifyEmailOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6, "OTP must be 6 digits"),
  name: z.string().optional(), // Optional during login context
});

// Schema for Google Login (Unchanged)
export const GoogleAuthSchema = z.object({
  token: z.string().min(10)
});