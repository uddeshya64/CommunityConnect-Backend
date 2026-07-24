import "express";

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      sessionId: string;
    }
  }
}

export {};