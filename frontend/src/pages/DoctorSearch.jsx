import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search, MapPin, Filter, X, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import DoctorCard from "../components/DoctorCard";
import { SPECIALTIES } from "../lib/specialties";

export default function DoctorSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const symptom = searchParams.get("symptom") || "";
  const specialtyParam = searchParams.get("specialty") || "";
  const cityParam = searchParams.get("city") || "";
  const maxFeeParam = searchParams.get("maxFee") || "";

  const [doctors, setDoctors] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [matchedSpecialty, setMatchedSpecialty] = useState(null);
  const [matchedSymptom, setMatchedSymptom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filters, setFilters] = useState({
    specialty: specialtyParam,
    city: cityParam,
    maxFee: maxFeeParam,
  });

  useEffect(() => {
    setFilters({
      specialty: specialtyParam,
      city: cityParam,
      maxFee: maxFeeParam,
    });
  }, [specialtyParam, cityParam, maxFeeParam]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError("");
      try {
        if (symptom) {
          // Attempt geolocation for distance sorting
          navigator.geolocation?.getCurrentPosition(
            async (pos) => {
              if (cancelled) return;
              const data = await api.symptomSearch(symptom, pos.coords.latitude, pos.coords.longitude);
              if (!cancelled) {
                setDoctors(data.doctors || []);
                setMatchedSpecialty(data.specialty);
                setMatchedSymptom(data.matchedSymptom);
              }
            },
            async () => {
              if (cancelled) return;
              const data = await api.symptomSearch(symptom);
              if (!cancelled) {
                setDoctors(data.doctors || []);
                setMatchedSpecialty(data.specialty);
                setMatchedSymptom(data.matchedSymptom);
              }
            }
          );
        } else {
          setMatchedSpecialty(null);
          setMatchedSymptom(null);
          const params = { page: 1, limit: 12 };
          if (specialtyParam) params.specialty = specialtyParam;
          if (cityParam) params.city = cityParam;
          if (maxFeeParam) params.maxFee = maxFeeParam;
          const data = await api.getDoctors(params);
          if (!cancelled) {
            const list = Array.isArray(data) ? data : (data?.data || []);
            setDoctors(list);
            setHasMore(data?.pagination?.hasMore || false);
            setPage(1);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [symptom, specialtyParam, cityParam, maxFeeParam]);

  function applyFilters(e) {
    e.preventDefault();
    const nextParams = {};
    if (filters.specialty) nextParams.specialty = filters.specialty;
    if (filters.city) nextParams.city = filters.city;
    if (filters.maxFee) nextParams.maxFee = filters.maxFee;
    setSearchParams(nextParams);
  }

  async function loadMoreDoctors() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const params = { page: nextPage, limit: 12 };
      if (specialtyParam) params.specialty = specialtyParam;
      if (cityParam) params.city = cityParam;
      if (maxFeeParam) params.maxFee = maxFeeParam;
      const data = await api.getDoctors(params);
      const list = Array.isArray(data) ? data : (data?.data || []);
      setDoctors((prev) => [...prev, ...list]);
      setPage(nextPage);
      setHasMore(data?.pagination?.hasMore || false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function clearAll() {
    setFilters({ specialty: "", city: "", maxFee: "" });
    setSearchParams({});
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {symptom ? (
        <div className="mb-8 rounded-2xl border border-sage-200 bg-sage-50/60 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sage-700 font-semibold">
              <Sparkles className="w-4 h-4 text-sage-600" />
              Symptom Lookup Match
            </div>
            <button
              onClick={() => navigate("/doctors")}
              className="text-xs font-semibold text-sage-700 hover:text-ink flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Clear symptom search
            </button>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">
            {matchedSpecialty ? (
              <>
                Recommended Specialist: <span className="text-sage-700">{matchedSpecialty}</span>
              </>
            ) : (
              "Finding specialist…"
            )}
          </h1>
          <p className="mt-1 text-xs text-inkSoft">
            Matched for query <span className="font-semibold text-ink">"{symptom}"</span>
            {matchedSymptom && ` (mapped from clinical tag: ${matchedSymptom})`}. Sorted by distance if location allowed.
          </p>
        </div>
      ) : (
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-ink">Find Verified Doctors</h1>
          <p className="text-sm text-inkSoft mt-1">
            Browse accredited medical practitioners by specialty, clinic city, and consultation fee.
          </p>

          <form onSubmit={applyFilters} className="mt-5 flex flex-wrap gap-3 items-center bg-white p-3.5 rounded-2xl border border-line shadow-sm">
            <select
              className="input-field !w-48 text-xs font-medium"
              value={filters.specialty}
              onChange={(e) => setFilters((f) => ({ ...f, specialty: e.target.value }))}
            >
              <option value="">All Specialties</option>
              {SPECIALTIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <input
              placeholder="City (e.g. Kolkata, Mumbai)"
              className="input-field !w-48 text-xs"
              value={filters.city}
              onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
            />

            <input
              placeholder="Max Fee (₹)"
              type="number"
              className="input-field !w-32 text-xs font-mono"
              value={filters.maxFee}
              onChange={(e) => setFilters((f) => ({ ...f, maxFee: e.target.value }))}
            />

            <button type="submit" className="btn-primary !py-2 text-xs flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" /> Apply Filters
            </button>

            {(specialtyParam || cityParam || maxFeeParam) && (
              <button
                type="button"
                onClick={clearAll}
                className="btn-secondary !py-2 text-xs"
              >
                Reset
              </button>
            )}
          </form>
        </div>
      )}

      {error && <p className="text-sm text-clay-600 bg-clay-50 p-3 rounded-lg border border-clay-200">{error}</p>}
      {loading && <p className="text-sm text-inkSoft">Loading doctors…</p>}

      {!loading && doctors.length === 0 && !error && (
        <div className="card p-12 text-center bg-white border border-line">
          <p className="text-ink font-semibold">No doctors found matching criteria.</p>
          <p className="text-xs text-inkSoft mt-1">Try clearing filters or searching for another specialty.</p>
          <button onClick={clearAll} className="btn-primary mt-4 text-xs">
            View All Doctors
          </button>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {doctors.map((doc) => (
          <DoctorCard key={doc.id} doctor={doc} />
        ))}
      </div>

      {hasMore && (
        <div className="mt-8 text-center">
          <button
            onClick={loadMoreDoctors}
            disabled={loadingMore}
            className="btn-secondary px-6 py-2.5 text-xs font-semibold"
          >
            {loadingMore ? "Loading more doctors…" : "Load More Doctors ↓"}
          </button>
        </div>
      )}
    </div>
  );
}
