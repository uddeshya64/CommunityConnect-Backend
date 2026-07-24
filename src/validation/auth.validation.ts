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

export const SendOtpSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address"),
    
  // Made optional so RESET doesn't require it
  password: z
    .string()
    .min(8, "Password must be 8+ chars")
    // Note: Constraints only run if password is provided
    .optional(), 

  context: z.enum(['REGISTER', 'RESET']).optional()
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