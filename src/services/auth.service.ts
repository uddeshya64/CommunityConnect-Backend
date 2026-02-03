import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key';

// --- EMAIL TRANSPORTER SETUP ---
// For dev: Use Ethereal.email or your personal Gmail with App Password
const transporter = nodemailer.createTransport({
  service: 'gmail', // Or 'SES', 'SendGrid'
  auth: {
    user: process.env.EMAIL_USER, // e.g., 'yourproject@gmail.com'
    pass: process.env.EMAIL_PASS  // App Password, not real password
  }
});

// In-memory OTP store (Replace with Redis in Prod)
const otpStore: Record<string, { hash: string; expires: number }> = {};

export class AuthService {
  
  // --- EMAIL OTP LOGIC ---

  static async initiateEmailAuth(email: string) {
    // 1. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 2. Hash OTP for security
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(otp, salt);

    // 3. Store with 10-minute expiry (Email delivery can be slower than SMS)
    otpStore[email] = {
      hash,
      expires: Date.now() + 10 * 60 * 1000
    };

    // 4. Send Email
    try {
      await transporter.sendMail({
        from: '"Hackathon Platform" <no-reply@hackathon.com>',
        to: email,
        subject: 'Your Verification Code',
        text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
        html: `<b>Your verification code is: ${otp}</b><br>It expires in 10 minutes.`
      });
      console.log(`[EMAIL_SENT] To: ${email} | Code (Dev Only): ${otp}`);
    } catch (error) {
      console.error("Email sending failed:", error);
      throw new Error("Failed to send email. Please try again.");
    }

    return { message: "OTP sent to email successfully" };
  }

  static async verifyEmailAndRegister(data: { email: string; name: string; otp: string }) {
    const { email, name, otp } = data;

    // 1. Check OTP Validity
    const storedOtp = otpStore[email];
    if (!storedOtp || storedOtp.expires < Date.now()) {
      throw new Error("OTP expired or not found");
    }

    const isValid = await bcrypt.compare(otp, storedOtp.hash);
    if (!isValid) throw new Error("Invalid OTP");

    // 2. Check if user exists (Idempotency)
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (user) {
      // Logic: If user exists, this acts as a Login
      // We don't need to re-create them.
    } else {
      // 3. Create User if they don't exist
      const randomPassword = randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await prisma.user.create({
        data: {
          name,
          email,
          password_hash: hashedPassword,
          created_at: new Date(),
        }
      });
    }

    // 4. Clear OTP
    delete otpStore[email];

    // 5. Generate JWT
    return this.generateToken(user.id);
  }

  // --- GOOGLE LOGIC (Unchanged) ---
  static async loginWithGoogle(googleProfile: { email: string; name: string }) {
    let user = await prisma.user.findUnique({ where: { email: googleProfile.email } });

    if (!user) {
      const randomPassword = randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await prisma.user.create({
        data: {
          email: googleProfile.email,
          name: googleProfile.name,
          password_hash: hashedPassword,
        }
      });
    }
    return this.generateToken(user.id);
  }

  private static generateToken(userId: number) {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
  }
}