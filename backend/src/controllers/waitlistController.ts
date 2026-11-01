import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import {
  addToWaitlist,
  getPatientWaitlist,
  cancelWaitlistEntry,
} from "../services/waitlistService";

// POST /waitlist - join waitlist for doctor day/slot
export async function joinWaitlist(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const patientId = req.user!.id;
    const { doctorId, slotDate, slotTime } = req.body;

    const entry = await addToWaitlist({
      doctorId,
      patientId,
      slotDate,
      slotTime,
    });

    res.status(201).json(entry);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "You are already on the waitlist for this doctor and date." });
    }
    next(err);
  }
}

// GET /waitlist/mine - list active waitlist entries
export async function getMyWaitlists(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const patientId = req.user!.id;
    const entries = await getPatientWaitlist(patientId);
    res.json(entries);
  } catch (err) {
    next(err);
  }
}

// DELETE /waitlist/:id - cancel waitlist entry
export async function leaveWaitlist(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const patientId = req.user!.id;
    const { id } = req.params;
    const cancelled = await cancelWaitlistEntry(id, patientId);
    if (!cancelled) {
      return res.status(404).json({ error: "Waitlist entry not found or already processed" });
    }
    res.json({ message: "Removed from waitlist", id });
  } catch (err) {
    next(err);
  }
}
