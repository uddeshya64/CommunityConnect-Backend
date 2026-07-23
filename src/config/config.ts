import dotenv from "dotenv";

dotenv.config();

const config = {
  PORT: process.env.PORT || 5000,

  JWT_SECRET:
    process.env.JWT_SECRET || "",

  GOOGLE_CLIENT_ID:
    process.env.GOOGLE_CLIENT_ID || "",

  GOOGLE_CLIENT_SECRET:
    process.env.GOOGLE_CLIENT_SECRET || "",

  GOOGLE_CALLBACK_URL:
    process.env.GOOGLE_CALLBACK_URL ||
    "https://communityconnect-backend-production.up.railway.app/api/auth/google/callback",

  FRONTEND_URL:
    process.env.FRONTEND_URL ||
    "http://localhost:3001",
};

export default config;
