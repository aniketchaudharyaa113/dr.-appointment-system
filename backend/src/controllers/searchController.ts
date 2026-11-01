import { Response, NextFunction, Request } from "express";
import pool from "../db/pool";
import { haversineDistance } from "../utils/haversine";
import { cacheGet, cacheSet } from "../cache/redis";
import { attachNextAvailableSlots } from "../services/slotService";

// GET /search/symptom?q=chest%20pain&lat=22.57&lng=88.36
export async function symptomSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, lat, lng } = req.query;

    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "q (symptom) is required" });
    }

    const trimmedQuery = q.trim().toLowerCase();
    const cacheKey = `medibook:search:symptom:${encodeURIComponent(trimmedQuery)}:${lat || ""}:${lng || ""}`;

    const cached = await cacheGet<{ specialty: string | null; doctors: any[]; message?: string }>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Step 1: symptom -> specialty lookup
    // First, try direct bidirectional substring matching:
    // e.g. input "chest pain" matches symptom "chest pain", or input "severe chest pain and weakness" matches symptom "chest pain"
    let mapResult = await pool.query(
      `SELECT specialty, symptom FROM symptom_specialty_map
       WHERE symptom ILIKE $1 OR $2 ILIKE ('%' || symptom || '%')
       ORDER BY LENGTH(symptom) DESC
       LIMIT 1`,
      [`%${trimmedQuery}%`, trimmedQuery]
    );

    // If no direct phrase match, tokenize words and check word-level matching
    if (mapResult.rows.length === 0) {
      const words = trimmedQuery.split(/\s+/).filter((w) => w.length > 2);
      if (words.length > 0) {
        mapResult = await pool.query(
          `SELECT specialty, symptom FROM symptom_specialty_map
           WHERE symptom = ANY($1::text[]) OR specialty = ANY($1::text[])
           LIMIT 1`,
          [words]
        );
      }
    }

    if (mapResult.rows.length === 0) {
      const responseData = {
        specialty: null,
        doctors: [],
        message: "No matching specialty found for that symptom. Try browsing all specialties.",
      };
      await cacheSet(cacheKey, responseData, 60);
      return res.json(responseData);
    }

    const specialty = mapResult.rows[0].specialty;

    // Step 2: verified doctors of that specialty with rating aggregates
    const doctorsResult = await pool.query(
      `SELECT d.id, d.specialty, d.clinic_name, d.clinic_address,
              d.clinic_lat, d.clinic_lng, d.consultation_fee, d.photo_url,
              d.experience_years, d.qualifications,
              u.name,
              ROUND(COALESCE(AVG(r.rating), 0), 1)::float AS avg_rating,
              COUNT(r.id)::int AS review_count
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN reviews r ON r.doctor_id = d.id
       WHERE d.specialty ILIKE $1 AND d.is_verified = true
       GROUP BY d.id, u.name`,
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
                  haversineDistance(patientLat, patientLng, Number(doc.clinic_lat), Number(doc.clinic_lng)).toFixed(2)
                )
              : null,
        }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }

    await attachNextAvailableSlots(doctors);

    const payload = { specialty, matchedSymptom: mapResult.rows[0].symptom, doctors };
    await cacheSet(cacheKey, payload, 180); // Cache for 3 minutes

    res.json(payload);
  } catch (err) {
    next(err);
  }
}
