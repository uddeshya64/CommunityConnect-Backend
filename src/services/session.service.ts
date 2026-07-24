import { PrismaClient, User } from "@prisma/client";
import { JwtUtil } from "../utils/jwt";
import { config } from "../config/env";

const prisma = new PrismaClient();

export class SessionService {

  /**
   * Create a new login session
   */
  static async createSession(user: User) {

    // Generate unique session ID
    const sessionId = JwtUtil.generateSessionId();

    // Generate access token
    const accessToken = JwtUtil.generateAccessToken({
      id: user.id,
      email: user.email,
      sessionId,
    });

    // Generate refresh token
    const refreshToken = JwtUtil.generateRefreshToken({
      id: user.id,
      email: user.email,
      sessionId,
    });

    // Refresh token expiry
    const expiresAt = new Date();
    expiresAt.setDate(
      expiresAt.getDate() +
      config.REFRESH_TOKEN_EXPIRES_DAYS
    );

    // Store session
    await prisma.userSession.create({
      data: {
        userId: user.id,
        sessionId,
        refreshToken,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Generate a new access token using refresh token
   */
  static async refreshSession(refreshToken: string) {

    let payload: any;

    try {
      payload = JwtUtil.verifyRefreshToken(refreshToken);
    } catch {
      throw new Error("Invalid or expired refresh token");
    }

    // Find session
    const session = await prisma.userSession.findUnique({
      where: {
        sessionId: payload.sessionId,
      },
      include: {
        user: true,
      },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    // Ensure refresh token matches database
    if (session.refreshToken !== refreshToken) {
      throw new Error("Invalid refresh token");
    }

    // Check expiry
    if (session.expiresAt < new Date()) {

      await prisma.userSession.deleteMany({
        where: {
          sessionId: payload.sessionId,
        },
      });

      throw new Error("Refresh token expired");
    }

    // Generate new access token
    const accessToken = JwtUtil.generateAccessToken({
      id: session.user.id,
      email: session.user.email,
      sessionId: session.sessionId,
    });

    return {
      accessToken,
    };
  }

  /**
   * Logout current device
   */
  static async logout(sessionId: string) {

  console.log("Deleting session:", sessionId);

  const result = await prisma.userSession.deleteMany({
    where: {
      sessionId,
    },
  });

  console.log(result);

  if (result.count === 0) {
    throw new Error("Already logged out or session not found");
  }

  return {
    success: true,
  };
}
  /**
   * Logout from all devices
   */
  static async logoutAll(userId: number) {

    await prisma.userSession.deleteMany({
      where: {
        userId,
      },
    });

    return {
      success: true,
    };
  }

}