import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "../config/env";

const ACCESS_SECRET = config.JWT_SECRET;
const REFRESH_SECRET = config.JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error("JWT secrets are not configured");
}

export interface AccessTokenPayload {
  id: number;
  email: string;
  sessionId: string;
}

export interface RefreshTokenPayload {
  id: number;
  email: string;
  sessionId: string;
}

export class JwtUtil {
  /**
   * Generate Access Token
   * Valid for 1 day
   */
  static generateAccessToken(
  payload: AccessTokenPayload
): string {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

static generateRefreshToken(
  payload: RefreshTokenPayload
): string {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: config.REFRESH_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}
  /**
   * Verify Access Token
   */
  static verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(
      token,
      ACCESS_SECRET
    ) as AccessTokenPayload;
  }

  /**
   * Verify Refresh Token
   */
  static verifyRefreshToken(
    token: string
  ): RefreshTokenPayload {
    return jwt.verify(
      token,
      REFRESH_SECRET
    ) as RefreshTokenPayload;
  }

  /**
   * Generate unique Session Id
   */
  static generateSessionId(): string {
    return crypto.randomUUID();
  }
}