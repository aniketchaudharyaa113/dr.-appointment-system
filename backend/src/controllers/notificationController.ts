import { Response, NextFunction } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../types";

// GET /notifications - returns user's notifications + unread count with pagination
export async function getMyNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1`,
      [userId]
    );
    const total = countRes.rows[0].total;

    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const unreadCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({
      notifications: result.rows,
      data: result.rows,
      unreadCount: unreadCount.rows[0].count,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + result.rows.length < total,
      },
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
