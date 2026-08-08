import { Link } from "react-router-dom";

export default function DoctorCard({ doctor }) {
  const fee = doctor.consultation_fee ? Number(doctor.consultation_fee) : null;

  return (
    <Link
      to={`/doctors/${doctor.id}`}
      className="card group block overflow-hidden transition-transform hover:-translate-y-0.5"
    >
      <div className="ticket-edge" style={{ "--ticket-bg": "#F4F6F4" }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-wide text-sage-600">
              {doctor.specialty}
            </p>
            <h3 className="mt-1 font-display text-lg font-semibold text-ink">
              {doctor.name}
            </h3>
          </div>
          {doctor.distanceKm != null && (
            <span className="whitespace-nowrap rounded-full bg-sage-50 px-2.5 py-1 text-xs font-mono text-sage-700">
              {doctor.distanceKm} km
            </span>
          )}
        </div>

        <p className="mt-2 text-sm text-inkSoft">
          {doctor.clinic_name || "Clinic details not listed"}
        </p>
        {doctor.clinic_address && (
          <p className="text-xs text-inkSoft/70">{doctor.clinic_address}</p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-dashed border-line pt-3">
          <span className="font-mono text-sm text-ink">
            {fee != null ? `₹${fee.toFixed(0)}` : "Fee on request"}
          </span>
          <span className="text-sm font-semibold text-sage-600 group-hover:underline">
            View & book →
          </span>
        </div>
      </div>
    </Link>
  );
}
