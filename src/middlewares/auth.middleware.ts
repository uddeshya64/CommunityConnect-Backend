import { Request, Response, NextFunction } from "express";
import { JwtUtil } from "../utils/jwt";

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Access token is required",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = JwtUtil.verifyAccessToken(token);

    req.user = decoded;

    console.log(req.user);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired access token",
    });
  }
};

export const optionalAuthenticate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];

    req.user = JwtUtil.verifyAccessToken(token);

    next();
  } catch {
    next();
  }
};