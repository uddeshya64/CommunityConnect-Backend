import "express";

declare global {
  namespace Express {
    interface UserPayload {
      id: number;
      email: string;
      sessionId: string;
    }

    interface Request {
      user: UserPayload;
    }
  }
}

export {};