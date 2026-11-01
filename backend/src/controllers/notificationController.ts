import { Response, NextFunction } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../types";

// GET /notifications - returns user's notifications + unread count
export async function getMyNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId]
    );

    const unreadCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({
      notifications: result.rows,
      unreadCount: unreadCount.rows[0].count,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /notifications/:id/read - mark one as read
export async function markAsRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE notifications SET is_read = true
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// PATCH /notifications/read-all - mark all as read
export async function markAllAsRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    await pool.query(
      `UPDATE notifications SET is_read = true
       WHERE user_id = $1`,
      [userId]
    );

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    next(err);
  }
}
