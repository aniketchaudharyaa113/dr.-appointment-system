import { Response, NextFunction, Request } from "express";
import pool from "../db/pool";
import { haversineDistance } from "../utils/haversine";
import { cacheGet, cacheSet } from "../cache/redis";
import { attachNextAvailableSlots } from "../services/slotService";
import { nowInClinicTimezone } from "../utils/datetime";

// GET /search/symptom?q=chest%20pain&lat=22.57&lng=88.36&minFee=100&maxFee=1000&minRating=4.0&maxDistance=20&availableToday=true&sort=distance
export async function symptomSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, lat, lng, specialty: overrideSpecialty, minFee, maxFee, minRating, maxDistance, availableToday, sort } = req.query;

    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "q (symptom) is required" });
    }

    const trimmedQuery = q.trim().toLowerCase();
    const cacheKey = `medibook:search:symptom:${encodeURIComponent(trimmedQuery)}:${encodeURIComponent(
      JSON.stringify(req.query)
    )}`;

    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Step 1: Use pg_trgm similarity matching to find top 3 matching specialties
    let mapResult = await pool.query(
      `SELECT specialty, symptom, similarity(symptom, $1) AS sim
       FROM symptom_specialty_map
       WHERE similarity(symptom, $1) > 0.1 OR symptom ILIKE ('%' || $1 || '%')
       ORDER BY sim DESC, LENGTH(symptom) ASC
       LIMIT 3`,
      [trimmedQuery]
    );

    // Fallback: word-level matching
    if (mapResult.rows.length === 0) {
      const words = trimmedQuery.split(/\s+/).filter((w) => w.length > 2);
      if (words.length > 0) {
        mapResult = await pool.query(
          `SELECT specialty, symptom, 0.5::float AS sim
           FROM symptom_specialty_map
           WHERE symptom = ANY($1::text[]) OR specialty = ANY($1::text[])
           LIMIT 3`,
          [words]
        );
      }
    }

    if (mapResult.rows.length === 0) {
      const responseData = {
        specialty: null,
        matchedSymptom: null,
        matches: [],
        doctors: [],
        message: "No matching specialty found for that symptom. Try browsing all specialties.",
      };
      await cacheSet(cacheKey, responseData, 60);
      return res.json(responseData);
    }

    const topMatches = mapResult.rows.map((r) => ({
      specialty: r.specialty,
      matchedSymptom: r.symptom,
      similarity: parseFloat(Number(r.sim || 0).toFixed(2)),
    }));

    const selectedSpecialty = (overrideSpecialty as string) || topMatches[0].specialty;
    const primaryMatchedSymptom = topMatches.find((m) => m.specialty === selectedSpecialty)?.matchedSymptom || topMatches[0].matchedSymptom;

    // Step 2: Fetch verified doctors of the selected specialty
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
      [selectedSpecialty]
    );

    let doctors = doctorsResult.rows;

    // Step 3: Compute distance if location coordinates are provided
    if (lat && lng) {
      const patientLat = parseFloat(lat as string);
      const patientLng = parseFloat(lng as string);

      doctors = doctors.map((doc) => ({
        ...doc,
        distanceKm:
          doc.clinic_lat && doc.clinic_lng
            ? Number(
                haversineDistance(patientLat, patientLng, Number(doc.clinic_lat), Number(doc.clinic_lng)).toFixed(2)
              )
            : null,
      }));
    }

    // Step 4: Attach next available slots server-side
    await attachNextAvailableSlots(doctors);

    // Step 5: Apply filters
    if (minFee) {
      doctors = doctors.filter((d) => Number(d.consultation_fee) >= Number(minFee));
    }
    if (maxFee) {
      doctors = doctors.filter((d) => Number(d.consultation_fee) <= Number(maxFee));
    }
    if (minRating) {
      doctors = doctors.filter((d) => Number(d.avg_rating) >= Number(minRating));
    }
    if (maxDistance && lat && lng) {
      doctors = doctors.filter((d) => d.distanceKm != null && d.distanceKm <= Number(maxDistance));
    }
    if (availableToday === "true") {
      const now = nowInClinicTimezone();
      const pad = (n: number) => String(n).padStart(2, "0");
      const todayStr = `${now.year}-${pad(now.month)}-${pad(now.day)}`;
      doctors = doctors.filter((d) => d.next_available_slot && d.next_available_slot.startsWith(todayStr));
    }

    // Step 6: Apply sorting
    if (sort === "distance" && lat && lng) {
      doctors.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    } else if (sort === "rating") {
      doctors.sort((a, b) => b.avg_rating - a.avg_rating || b.review_count - a.review_count);
    } else if (sort === "fee_asc") {
      doctors.sort((a, b) => Number(a.consultation_fee) - Number(b.consultation_fee));
    } else if (sort === "fee_desc") {
      doctors.sort((a, b) => Number(b.consultation_fee) - Number(a.consultation_fee));
    } else if (sort === "experience") {
      doctors.sort((a, b) => b.experience_years - a.experience_years);
    } else if (lat && lng) {
      doctors.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    } else {
      doctors.sort((a, b) => b.avg_rating - a.avg_rating || b.experience_years - a.experience_years);
    }

    const payload = {
      specialty: selectedSpecialty,
      matchedSymptom: primaryMatchedSymptom,
      matches: topMatches,
      doctors,
    };

    await cacheSet(cacheKey, payload, 180); // 3 minutes cache

    res.json(payload);
  } catch (err) {
    next(err);
  }
}
