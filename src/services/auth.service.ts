import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { randomBytes } from "crypto";
import { config } from '../config/env';
import { EmailService } from './email.service';

if (!config.JWT_SECRET || !config.RESET_TOKEN_SECRET) {
  console.error("❌ FATAL ERROR: JWT_SECRET or RESET_SECRET is missing in .env");
  process.exit(1); 
}
const JWT_SECRET = config.JWT_SECRET;
const RESET_TOKEN_SECRET = config.RESET_TOKEN_SECRET;

const prisma = new PrismaClient();
const otpStore: Record<string, any> = {}; // Use Redis in production

// --- EMAIL TRANSPORTER SETUP ---
const transporter = nodemailer.createTransport({
  service: "gmail", // Or 'SES', 'SendGrid'
  auth: {
    user: config.EMAIL_USER, // 
    pass: config.EMAIL_PASS, // 
  },
});

export class AuthService {

// --- 1. UNIFIED SEND OTP ---
  static async sendOtp(email: string, password?: string, context: 'REGISTER' | 'RESET' = 'REGISTER') {
    const user = await prisma.user.findUnique({ where: { email } });

    // SECURITY CHECK: Context Isolation
    if (context === 'REGISTER') {
      if (user) throw new Error("User already exists. Please login.");
      // For registration, password MUST be provided
      if (!password) throw new Error("Password is required for registration.");
    }
    
    if (context === 'RESET' && !user) {
      // Fake success to prevent Email Enumeration
      return { message: "OTP sent to email successfully" }; 
    }

    // Generate & Store
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hash = await bcrypt.hash(otp, 10);

    // Only hash the password if it exists (Registration path)
    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
    otpStore[email] = {
      hash,
      passwordHash,
      context, // <--- CRITICAL: Locks the OTP to this specific action
      expires: Date.now() + 10 * 60 * 1000 // 10 mins
    };

    await EmailService.sendOtpEmail(email, otp);

    return { message: "OTP sent to email successfully" };
  }

  // --- 2. UNIFIED VERIFY OTP ---
  static async verifyOtp( 
    name : string,
    email: string,
    otp: string,
    context: 'REGISTER' | 'RESET'
  ) {
    const data = otpStore[email];

    // Validations
    if (!data) throw new Error("OTP expired or invalid");
    if (data.context !== context) throw new Error("Invalid OTP context"); // Prevents hacking
    
    const isValid = await bcrypt.compare(otp, data.hash);
    if (!isValid) throw new Error("Invalid OTP");

    // ISSUE TOKEN BASED ON CONTEXT
    if (context === 'RESET') {
      delete otpStore[email]; // Clear it
      return jwt.sign({ id: email, purpose: 'reset_pass' }, config.RESET_TOKEN_SECRET!, { expiresIn: '5m' });

    }else {
      // Create User if they don't exist
        const user = await prisma.user.create({
          data: {
            name,
            email,
            password_hash: data.passwordHash,
            created_at: new Date(),
          },
        });

        delete otpStore[email]; // Clear it

        return jwt.sign(
        { id: user.id, email: user.email, purpose: 'email_verified' }, 
        config.JWT_SECRET!, 
        { expiresIn: '15m' }
        );
    }
    
  }

  // --- 3. RESET PASSWORD ACTION ---
  static async resetPassword(token: string, newPass: string) {
    // Verify Token
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.RESET_TOKEN_SECRET!);
    } catch {
      throw new Error("Invalid or expired token");
    }

    if (decoded.purpose !== 'reset_pass') throw new Error("Invalid token type");

    // Update DB
    const hash = await bcrypt.hash(newPass, 10);
    await prisma.user.update({
      where: { email: decoded.id },
      data: { password_hash: hash }
    });
  }

  // --- LOGIN LOGIC ---
  static async loginWithEmail(email: string, password: string) {
    // 1. Find User
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new Error("Invalid email or password");
    }

    // 2. Verify Password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error("Invalid email or password");
    }
    // 3. Generate JWT
    return this.generateToken(user.id);
  }

  
  
  // --- GOOGLE LOGIC (Unchanged) ---
  static async loginWithGoogle(googleProfile: { email: string; name: string }) {
    let user = await prisma.user.findUnique({
      where: { email: googleProfile.email },
    });

    if (!user) {
      const randomPassword = randomBytes(16).toString("hex");
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await prisma.user.create({
        data: {
          email: googleProfile.email,
          name: googleProfile.name,
          password_hash: hashedPassword,
        },
      });
    }
    return this.generateToken(user.id);
  }

  private static generateToken(userId: number) {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: "7d" });
  }
}
