import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { config } from "../config/env";
import { EmailService } from "./email.service";
import { SessionService } from "./session.service";

if (!config.JWT_SECRET || !config.RESET_TOKEN_SECRET) {
  console.error("❌ FATAL ERROR: JWT_SECRET or RESET_SECRET is missing in .env");
  process.exit(1);
}

const prisma = new PrismaClient();
const otpStore: Record<string, any> = {};

export class AuthService {

  // ---------------- SEND OTP ----------------

  static async sendOtp(
    email: string,
    password?: string,
    context: "REGISTER" | "RESET" = "REGISTER"
  ) {

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (context === "REGISTER") {
      if (user) {
        throw new Error("User already exists. Please login.");
      }

      if (!password) {
        throw new Error("Password is required for registration.");
      }
    }

    if (context === "RESET" && !user) {
      return {
        message: "OTP sent successfully",
      };
    }

    const otp = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    const hash = await bcrypt.hash(otp, 10);

    const passwordHash = password
      ? await bcrypt.hash(password, 10)
      : undefined;

    otpStore[email] = {
      hash,
      passwordHash,
      context,
      expires: Date.now() + 10 * 60 * 1000,
    };

    await EmailService.sendOtpEmail(email, otp);

    return {
      message: "OTP sent successfully",
    };
  }

  // ---------------- VERIFY REGISTER OTP ----------------

  static async verifyRegisterOtp(
    name: string,
    email: string,
    otp: string
  ) {

    const data = otpStore[email];

    if (!data) {
      throw new Error("OTP expired or invalid");
    }

    if (data.context !== "REGISTER") {
      throw new Error("Invalid OTP context");
    }

    const isValid = await bcrypt.compare(
      otp,
      data.hash
    );

    if (!isValid) {
      throw new Error("Invalid OTP");
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password_hash: data.passwordHash,
        created_at: new Date(),
      },
    });

    delete otpStore[email];

    return await SessionService.createSession(user);
  }

  // ---------------- VERIFY RESET OTP ----------------

  static async verifyResetOtp(
    email: string,
    otp: string
  ) {

    const data = otpStore[email];

    if (!data) {
      throw new Error("OTP expired or invalid");
    }

    if (data.context !== "RESET") {
      throw new Error("Invalid OTP context");
    }

    const isValid = await bcrypt.compare(
      otp,
      data.hash
    );

    if (!isValid) {
      throw new Error("Invalid OTP");
    }

    delete otpStore[email];

    return jwt.sign(
      {
        id: email,
        purpose: "reset_pass",
      },
      config.RESET_TOKEN_SECRET!,
      {
        expiresIn: "5m",
      }
    );
  }

  // ---------------- RESET PASSWORD ----------------

  static async resetPassword(
    token: string,
    newPassword: string
  ) {

    let decoded: any;

    try {
      decoded = jwt.verify(
        token,
        config.RESET_TOKEN_SECRET!
      );
    } catch {
      throw new Error("Invalid or expired token");
    }

    if (decoded.purpose !== "reset_pass") {
      throw new Error("Invalid token");
    }

    const hash = await bcrypt.hash(
      newPassword,
      10
    );

    await prisma.user.update({
      where: {
        email: decoded.id,
      },
      data: {
        password_hash: hash,
      },
    });
  }

  // ---------------- LOGIN ----------------

  static async loginWithEmail(
    email: string,
    password: string
  ) {

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      throw new Error("Invalid email or password");
    }

    if (!user.password_hash) {
      throw new Error("Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      throw new Error("Invalid email or password");
    }

    return await SessionService.createSession(user);
  }

  // ---------------- GOOGLE LOGIN ----------------

  static async loginWithGoogle(
    googleProfile: {
      email: string;
      name: string;
    }
  ) {

    let user = await prisma.user.findUnique({
      where: {
        email: googleProfile.email,
      },
    });

    if (!user) {

      const randomPassword = randomBytes(16).toString("hex");

      const hashedPassword = await bcrypt.hash(
        randomPassword,
        10
      );

      user = await prisma.user.create({
        data: {
          email: googleProfile.email,
          name: googleProfile.name,
          password_hash: hashedPassword,
        },
      });
    }

    return await SessionService.createSession(user);
  }
}