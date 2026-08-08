import { Response, NextFunction } from "express";
import { Request } from "express";
import pool from "../db/pool";
import { haversineDistance } from "../utils/haversine";

// GET /search/symptom?q=chest%20pain&lat=22.57&lng=88.36
export async function symptomSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, lat, lng } = req.query;

    if (!q) {
      return res.status(400).json({ error: "q (symptom) is required" });
    }

    // Step 1: symptom -> specialty (plain lookup table, no AI)
    const mapResult = await pool.query(
      `SELECT specialty FROM symptom_specialty_map WHERE symptom ILIKE $1 LIMIT 1`,
      [`%${q}%`]
    );

    if (mapResult.rows.length === 0) {
      return res.json({ specialty: null, doctors: [], message: "No matching specialty found for that symptom" });
    }

    const specialty = mapResult.rows[0].specialty;

    // Step 2: verified doctors of that specialty
    const doctorsResult = await pool.query(
      `SELECT d.id, d.specialty, d.clinic_name, d.clinic_address,
              d.clinic_lat, d.clinic_lng, d.consultation_fee, d.photo_url,
              u.name
       FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE d.specialty ILIKE $1 AND d.is_verified = true`,
      [specialty]
    );

    let doctors = doctorsResult.rows;

    // Step 3: if the patient shared their location, sort by distance
    if (lat && lng) {
      const patientLat = parseFloat(lat as string);
      const patientLng = parseFloat(lng as string);

      doctors = doctors
        .map((doc) => ({
          ...doc,
          distanceKm:
            doc.clinic_lat && doc.clinic_lng
              ? Number(
                  haversineDistance(patientLat, patientLng, doc.clinic_lat, doc.clinic_lng).toFixed(2)
                )
              : null,
        }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }

    res.json({ specialty, doctors });
  } catch (err) {
    next(err);
  }
}
