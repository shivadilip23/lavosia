import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "./db.ts";

function getJwtSecret(): string {
  return process.env.SESSION_SECRET || "lavosia_jwt_session_secret_change_in_production";
}

export const COOKIE_NAME = "lavosia_session";

export interface SessionPayload {
  userId: number;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role: string;
        status: string;
      };
    }
  }
}

export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionPayload;
  } catch (err) {
    return null;
  }
}

export function getSessionCookieOptions(req?: Request) {
  // If platform serves HTTPS (Cloud Run, reverse proxy, or APP_URL is https)
  // or non-production iframe preview, set sameSite: "none" and secure: true.
  const isHttps =
    Boolean(process.env.APP_URL?.startsWith("https")) ||
    Boolean(req?.secure) ||
    req?.headers?.["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV !== "production";

  if (isHttps) {
    return {
      httpOnly: true,
      sameSite: "none" as const,
      secure: true,
      path: "/",
    };
  }

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string, req?: Request): void {
  const options = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, token, {
    ...options,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

export function clearSessionCookie(res: Response, req?: Request): void {
  const options = getSessionCookieOptions(req);
  res.clearCookie(COOKIE_NAME, {
    ...options,
  });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Authentication required. Please log in." });
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload || !payload.userId) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Session expired or invalid. Please log in again." });
    return;
  }

  // Verify user still exists in database and is active
  const user = db.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(payload.userId) as any;
  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ error: "User account no longer exists." });
    return;
  }

  if (user.status === "disabled") {
    clearSessionCookie(res);
    res.status(403).json({ error: "This account has been disabled by an administrator." });
    return;
  }

  req.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
  };

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Access denied. Administrator privileges required." });
    return;
  }
  next();
}
