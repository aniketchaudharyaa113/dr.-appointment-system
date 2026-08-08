import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import DoctorCard from "../components/DoctorCard";
import { SPECIALTIES } from "../lib/specialties";

export default function DoctorSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const symptom = searchParams.get("symptom");
  const specialtyParam = searchParams.get("specialty") || "";

  const [doctors, setDoctors] = useState([]);
  const [matchedSpecialty, setMatchedSpecialty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ specialty: specialtyParam, city: "", maxFee: "" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError("");
      try {
        if (symptom) {
          // Ask the browser for location so results can be sorted by distance.
          // If the user denies it, we still show results, just unsorted.
          navigator.geolocation?.getCurrentPosition(
            async (pos) => {
              const data = await api.symptomSearch(symptom, pos.coords.latitude, pos.coords.longitude);
              if (!cancelled) {
                setDoctors(data.doctors);
                setMatchedSpecialty(data.specialty);
              }
            },
            async () => {
              const data = await api.symptomSearch(symptom);
              if (!cancelled) {
                setDoctors(data.doctors);
                setMatchedSpecialty(data.specialty);
              }
            }
          );
        } else {
          const params = {};
          if (filters.specialty) params.specialty = filters.specialty;
          if (filters.city) params.city = filters.city;
          if (filters.maxFee) params.maxFee = filters.maxFee;
          const data = await api.getDoctors(params);
          if (!cancelled) setDoctors(data);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symptom, filters]);

  function applyFilters(e) {
    e.preventDefault();
    setSearchParams(filters.specialty ? { specialty: filters.specialty } : {});
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {symptom ? (
        <div className="mb-8">
          <p className="font-mono text-xs uppercase tracking-wide text-sage-600">
            Symptom: "{symptom}"
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-ink">
            {matchedSpecialty ? `You probably need a ${matchedSpecialty}` : "Searching…"}
          </h1>
        </div>
      ) : (
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-ink">Find a doctor</h1>
          <form onSubmit={applyFilters} className="mt-4 flex flex-wrap gap-3">
            <select
              className="input-field !w-48"
              value={filters.specialty}
              onChange={(e) => setFilters((f) => ({ ...f, specialty: e.target.value }))}
            >
              <option value="">Any specialty</option>
              {SPECIALTIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              placeholder="City"
              className="input-field !w-48"
              value={filters.city}
              onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
            />
            <input
              placeholder="Max fee (₹)"
              type="number"
              className="input-field !w-36"
              value={filters.maxFee}
              onChange={(e) => setFilters((f) => ({ ...f, maxFee: e.target.value }))}
            />
            <button type="submit" className="btn-primary">Search</button>
          </form>
        </div>
      )}

      {error && <p className="text-sm text-clay-600">{error}</p>}
      {loading && <p className="text-sm text-inkSoft">Loading doctors…</p>}

      {!loading && doctors.length === 0 && !error && (
        <div className="card p-10 text-center">
          <p className="text-inkSoft">No doctors matched. Try a different search.</p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {doctors.map((doc) => (
          <DoctorCard key={doc.id} doctor={doc} />
        ))}
      </div>
    </div>
  );
}
