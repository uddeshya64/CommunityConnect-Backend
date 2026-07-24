import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Database
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // JWT
  JWT_SECRET: z.string().min(10, "JWT_SECRET is too short!"),
  JWT_REFRESH_SECRET: z.string().min(10, "JWT_REFRESH_SECRET is too short!"),
  RESET_TOKEN_SECRET: z.string().min(10, "RESET_TOKEN_SECRET is too short!"),

  ACCESS_TOKEN_EXPIRES_IN: z.string().default("1d"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("15d"),

  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().default(15),

  // Brevo SMTP
  BREVO_SMTP_USER: z.string().email(),
  BREVO_SMTP_KEY: z.string().min(1),
  BREVO_SENDER_EMAIL: z.string().email(),
  BREVO_SENDER_NAME: z.string().default("CommunityConnect"),

  FRONTEND_URL: z.string().url(),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),

  // App
  PORT: z.string().default("3000"),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error(
    "❌ INVALID ENVIRONMENT VARIABLES:",
    _env.error.format()
  );
  process.exit(1);
}

export const config = _env.data;