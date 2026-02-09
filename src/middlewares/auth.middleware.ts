import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env'; // Your secure config file

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Get the token from the header
    // Format: "Bearer eyJhbGciOi..."
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(' ')[1]; // Take the second part

    // 2. Verify the token
    const decoded = jwt.verify(token, config.JWT_SECRET) as { id: number; email: string; purpose?: string };

    // 3. Security Check: Token Purpose
    // Prevent using a "Password Reset Token" to access Profile
    if (decoded.purpose && decoded.purpose !== 'email_verified' && decoded.purpose !== 'login') {
       // Note: Adjust 'login' based on what you put in your login payload.
       // Usually login tokens don't have a 'purpose' field, or it's 'access'.
       // If your login token payload is just { id: 1 }, this check is optional but good practice.
    }

    // 4. Attach user to request
    req.user = decoded;

    // 5. Move to the Controller
    next(); 

  } catch (error) {
    return res.status(403).json({ error: "Forbidden: Invalid or expired token" });
  }
};