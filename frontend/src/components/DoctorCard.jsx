import { Link } from "react-router-dom";
import { Star, MapPin, Award, Clock } from "lucide-react";
import { formatSlot } from "../lib/format";

export default function DoctorCard({ doctor }) {
  const fee = doctor.consultation_fee ? Number(doctor.consultation_fee) : null;
  const rating = doctor.avg_rating ? Number(doctor.avg_rating) : null;
  const reviewsCount = doctor.review_count ? Number(doctor.review_count) : 0;

  return (
    <Link
      to={`/doctors/${doctor.id}`}
      className="card group block overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg border border-line hover:border-sage-400 bg-white"
    >
      <div className="ticket-edge" style={{ "--ticket-bg": "#F4F6F4" }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider font-semibold text-sage-600 bg-sage-50 px-2 py-0.5 rounded">
              {doctor.specialty}
            </span>
            <h3 className="mt-1.5 font-display text-lg font-bold text-ink group-hover:text-sage-700 transition-colors">
              {doctor.name}
            </h3>
            {doctor.qualifications && (
              <p className="text-xs text-inkSoft mt-0.5">{doctor.qualifications}</p>
            )}
          </div>
          {doctor.distanceKm != null && (
            <span className="whitespace-nowrap rounded-full bg-sage-50 px-2.5 py-1 text-xs font-mono text-sage-700 font-semibold border border-sage-200">
              {doctor.distanceKm} km
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs text-inkSoft">
          {rating ? (
            <span className="flex items-center gap-1 font-semibold text-amber-600">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
              {rating.toFixed(1)} <span className="font-normal text-inkSoft">({reviewsCount})</span>
            </span>
          ) : (
            <span className="text-inkSoft/80 italic">New on platform</span>
          )}
          {doctor.experience_years > 0 && (
            <span className="flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-sage-600" /> {doctor.experience_years} yrs exp
            </span>
          )}
        </div>

        <p className="mt-2 text-sm text-ink font-medium">
          {doctor.clinic_name || "Clinic details"}
        </p>
        {doctor.clinic_address && (
          <p className="text-xs text-inkSoft/80 flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3 text-inkSoft/60 shrink-0" />
            <span className="truncate">{doctor.clinic_address}</span>
          </p>
        )}

        {doctor.next_available_slot ? (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-sage-50/90 px-2.5 py-1 text-xs text-sage-800 border border-sage-200">
            <Clock className="w-3.5 h-3.5 text-sage-600 shrink-0" />
            <span className="truncate">
              Next: <strong className="font-semibold text-sage-900">{formatSlot(doctor.next_available_slot)}</strong>
            </span>
          </div>
        ) : (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-paperDim px-2.5 py-1 text-xs text-inkSoft">
            <Clock className="w-3.5 h-3.5 text-inkSoft/60 shrink-0" />
            <span>Check profile for waitlist</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-dashed border-line pt-3">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-inkSoft">Consultation</span>
            <span className="font-mono text-sm font-semibold text-ink">
              {fee != null ? `₹${fee.toFixed(0)}` : "On request"}
            </span>
          </div>
          <span className="text-xs font-semibold text-sage-600 group-hover:translate-x-0.5 transition-transform">
            View profile & book →
          </span>
        </div>
      </div>
    </Link>
  );
}
