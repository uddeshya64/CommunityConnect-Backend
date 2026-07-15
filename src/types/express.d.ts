// Elaboration: TypeScript is strict. By default, the Express Request object does not have a user property. This code effectively "patches" Express to say, "Hey, in our app, a Request might contain a user object with these specific fields."

// Reasoning: Without this, your code req.user.id would throw a compile-time error: Property 'user' does not exist on type 'Request'.

// Production Importance: Type Safety. In a large team, if a developer tries to access req.user.phoneNumber (which doesn't exist on the token), TypeScript will crash the build before you deploy, preventing runtime errors.

import { Request } from 'express';

// We are "extending" the standard Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        purpose?: string; // For distinguishing Access vs Reset tokens
      };
    }
  }
}