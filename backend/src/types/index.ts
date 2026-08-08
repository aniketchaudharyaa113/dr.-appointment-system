import { Request } from "express";

export type Role = "PATIENT" | "DOCTOR" | "ADMIN";

export interface JwtPayload {
  id: string;
  role: Role;
}

// Extends Express's Request so req.user is typed after authMiddleware runs
export interface AuthRequest extends Request {
  user?: JwtPayload;
}
