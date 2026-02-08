import { z } from 'zod';

// Schema for initiating EMAIL registration
// export const EmailRegisterSchema = z.object({
//   email: z.string().email("Invalid email format"),
//   name: z.string().min(2, "Name must be at least 2 chars"),
// });

// Schema for verifying OTP
export const VerifyEmailOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6, "OTP must be 6 digits"),
  name: z.string().optional(), // Optional during login context
  context: z.enum(['REGISTER', 'RESET']),
});

// 1. Schema for Requesting OTP (Used for both Register & Forgot Pass)
export const SendOtpSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string()
    .min(8, "Password must be 8+ chars")
    // .regex(/[A-Z]/, "Needs uppercase")
    // .regex(/[0-9]/, "Needs number")
    // .regex(/[^A-Za-z0-9]/, "Needs special char"),
  ,context: z.enum(['REGISTER', 'RESET']).optional() // Optional because we might infer it from the URL
});

// 2. Schema for Verifying OTP
export const VerifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6, "OTP must be 6 digits"),
  context: z.enum(['REGISTER', 'RESET']) // Mandatory here for security!
});

// 3. Schema for Resetting Password (The big one)
export const ResetPasswordSchema = z.object({
  token: z.string().min(10, "Invalid token"), // The JWT we gave them
  newPassword: z.string()
    // .min(8, "Password must be 8+ chars")
    // .regex(/[A-Z]/, "Needs uppercase")
    // .regex(/[0-9]/, "Needs number")
    // .regex(/[^A-Za-z0-9]/, "Needs special char"),
  ,confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// Schema for Google Login (Unchanged)
// export const GoogleAuthSchema = z.object({
//   token: z.string().min(10)
// });