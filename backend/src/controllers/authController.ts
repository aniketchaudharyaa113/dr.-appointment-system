import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../db/pool";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setRefreshTokenCookie(res: Response, rawToken: string) {
  res.cookie("refreshToken", rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/auth",
  });
}

async function createRefreshToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString("hex");
  const tokenHash = hashToken(rawToken);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [userId, tokenHash]
  );
  return rawToken;
}

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, name, phone, role } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const allowedRoles = ["PATIENT", "DOCTOR"]; // nobody signs up as ADMIN directly
    const finalRole = allowedRoles.includes(role as string) ? role : "PATIENT";

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password, name, phone, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role`,
      [email, hashed, name, phone || null, finalRole]
    );

    const user = result.rows[0];

    if (finalRole === "DOCTOR") {
      await pool.query(
        `INSERT INTO doctors (user_id, specialty) VALUES ($1, $2)`,
        [user.id, "Not set"]
      );
    }

    // Short-lived 15-minute access token
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET as string, {
      expiresIn: "15m",
    });

    // Rotating refresh token stored hashed in DB
    const refreshToken = await createRefreshToken(user.id);
    setRefreshTokenCookie(res, refreshToken);

    res.status(201).json({ token, refreshToken, user });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Short-lived 15-minute access token
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET as string, {
      expiresIn: "15m",
    });

    // Rotating refresh token stored hashed in DB
    const refreshToken = await createRefreshToken(user.id);
    setRefreshTokenCookie(res, refreshToken);

    res.json({
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!rawToken) {
      return res.status(401).json({ error: "Refresh token is required" });
    }

    const tokenHash = hashToken(rawToken);

    // Look up non-revoked, unexpired refresh token
    const tokenRes = await pool.query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(401).json({ error: "Invalid, revoked, or expired refresh token" });
    }

    const currentToken = tokenRes.rows[0];

    // Atomically revoke current refresh token (rotation)
    await pool.query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [currentToken.id]);

    const userRes = await pool.query(
      `SELECT id, email, name, role FROM users WHERE id = $1`,
      [currentToken.user_id]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: "User no longer exists" });
    }

    const user = userRes.rows[0];

    // Issue new 15-minute access token and new rotated refresh token
    const newAccessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: "15m" }
    );

    const newRefreshToken = await createRefreshToken(user.id);
    setRefreshTokenCookie(res, newRefreshToken);

    res.json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await pool.query(`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`, [tokenHash]);
    }

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/auth",
    });

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
}
