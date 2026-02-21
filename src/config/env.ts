import 'dotenv/config'; // Loads the .env file
import { z } from 'zod';

// 1. Define the Schema (The Rules)
const envSchema = z.object({
  // Database (Prisma needs this)
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Security Secrets (CRITICAL)
  JWT_SECRET: z.string().min(10, "JWT_SECRET is too short!"),
  JWT_REFRESH_SECRET:z.string().min(10, "JWT_REFRESH_SECRET is too short!"),
  RESET_TOKEN_SECRET: z.string().min(10, "RESET_TOKEN_SECRET is too short!"),

  // Email Config
  EMAIL_USER: z.string().email(),
  EMAIL_PASS: z.string().min(1),

  FRONTEND_URL: z.string().url("Must be a valid URL"), 
  // RAZORPAY CONFIG
  RAZORPAY_KEY_ID: z.string().min(1, "Razorpay Key ID is required"),
  RAZORPAY_KEY_SECRET: z.string().min(1, "Razorpay Key Secret is required"),
  
  // App Config
  PORT: z.string().default("3000"),
});

// 2. Validate 'process.env' against the rules
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ INVALID ENVIRONMENT VARIABLES:", _env.error.format());
  process.exit(1); // Stop the app if variables are missing
}

// 3. Export the validated config
export const config = _env.data;