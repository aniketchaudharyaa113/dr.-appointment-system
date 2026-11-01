import { useEffect, useState } from "react";
import { FileText, MapPin, XCircle, Star, Calendar } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import StarRating from "../components/StarRating";
import PrescriptionModal from "../components/PrescriptionModal";
import { formatSlot } from "../lib/format";

function StatusBadge({ status }) {
  const styles = {
    CONFIRMED: "bg-sage-50 text-sage-700 border border-sage-200",
    COMPLETED: "bg-line/60 text-inkSoft border border-line",
    CANCELLED: "bg-clay-500/10 text-clay-600 border border-clay-200",
    PENDING: "bg-amber-50 text-amber-700 border border-amber-200",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-mono font-medium ${styles[status] || ""}`}>
      {status}
    </span>
  );
}

function ReviewForm({ appt, token, onDone }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSubmitting(true);
    setMsg("");
    try {
      await api.createReview({ appointmentId: appt.id, doctorId: appt.doctor_id, rating, comment }, token);
      setMsg("Thanks for the review!");
      onDone?.();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-card border border-dashed border-line bg-paperDim/30 p-3.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-inkSoft font-medium">Your rating:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className="text-xl leading-none transition-transform hover:scale-110">
            <span className={n <= rating ? "text-amber-500" : "text-line"}>★</span>
          </button>
        ))}
      </div>
      <textarea
        className="input-field mt-2 text-sm"
        rows={2}
        placeholder="How was the consultation experience? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="mt-2 flex items-center justify-between">
        <button onClick={submit} disabled={submitting} className="btn-secondary !py-1.5 text-xs">
          {submitting ? "Submitting…" : "Submit review"}
        </button>
        {msg && <p className="text-xs text-sage-600 font-medium">{msg}</p>}
      </div>
    </div>
  );
}

export default function PatientDashboard() {
  const { token } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null);
  const [activePrescription, setActivePrescription] = useState(null);
  const [prescriptionLoading, setPrescriptionLoading] = useState(false);

  function load() {
    setLoading(true);
    api.getMyAppointments(token).then(setAppointments).finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function handleCancel(id) {
    const reason = prompt("Optional reason for cancellation (or click OK to confirm):");
    if (reason === null) return;
    await api.cancelAppointment(id, token, reason || "Patient requested cancellation");
    load();
  }

  async function viewPrescription(appointmentId) {
    setPrescriptionLoading(true);
    try {
      const rx = await api.getPrescriptionByAppointment(appointmentId, token);
      setActivePrescription(rx);
    } catch (err) {
      alert(err.message || "Could not load prescription");
    } finally {
      setPrescriptionLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">My Appointments</h1>
          <p className="text-sm text-inkSoft mt-1">Track your clinic bookings, digital prescriptions, and visit history.</p>
        </div>
      </div>

      {loading && <p className="mt-6 text-inkSoft">Loading appointments…</p>}
      {!loading && appointments.length === 0 && (
        <div className="card mt-6 p-10 text-center text-inkSoft">
          You haven't booked any appointments yet.
        </div>
      )}

      <div className="mt-6 space-y-4">
        {appointments.map((appt) => (
          <div key={appt.id} className="card p-5 border border-line bg-white shadow-sm hover:shadow transition-shadow">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-xs font-bold text-sage-600 bg-sage-50 px-2 py-0.5 rounded border border-sage-200">
                  {appt.booking_ref}
                </span>
                <p className="font-display text-lg font-bold text-ink mt-1.5">{appt.doctor_name}</p>
                <p className="text-sm text-inkSoft">{appt.specialty} · {appt.clinic_name}</p>
                <p className="mt-1 font-mono text-xs text-ink font-semibold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-sage-600" />
                  {formatSlot(appt.slot_time)}
                </p>
              </div>
              <StatusBadge status={appt.status} />
            </div>

            {(appt.clinic_address || (appt.clinic_lat && appt.clinic_lng)) && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card bg-paperDim px-3 py-2 text-xs">
                <span className="text-inkSoft flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-inkSoft/70 shrink-0" />
                  {appt.clinic_address}
                </span>
                <a
                  href={
                    appt.clinic_lat && appt.clinic_lng
                      ? `https://www.google.com/maps/dir/?api=1&destination=${appt.clinic_lat},${appt.clinic_lng}`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appt.clinic_address)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="whitespace-nowrap font-semibold text-sage-600 hover:underline"
                >
                  Directions →
                </a>
              </div>
            )}

            {appt.notes && (
              <div className="mt-3 rounded-card bg-paperDim/70 px-3 py-2 text-xs text-inkSoft">
                <span className="font-semibold text-ink">Clinical Notes:</span> {appt.notes}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/50 pt-3">
              {appt.status === "CONFIRMED" && (
                <button
                  onClick={() => handleCancel(appt.id)}
                  className="btn-secondary !py-1.5 text-xs text-clay-600 hover:bg-clay-50"
                >
                  Cancel appointment
                </button>
              )}

              {appt.prescription_id && (
                <button
                  onClick={() => viewPrescription(appt.id)}
                  disabled={prescriptionLoading}
                  className="btn-primary !py-1.5 text-xs flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" /> View Prescription
                </button>
              )}

              {appt.status === "COMPLETED" && !appt.review_id && reviewing !== appt.id && (
                <button onClick={() => setReviewing(appt.id)} className="btn-secondary !py-1.5 text-xs flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-amber-500" /> Leave a review
                </button>
              )}

              {appt.status === "COMPLETED" && appt.review_id && (
                <span className="text-xs text-amber-600 font-medium flex items-center gap-1 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                  <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" /> Rated {appt.review_rating}★
                </span>
              )}
            </div>

            {reviewing === appt.id && (
              <ReviewForm appt={appt} token={token} onDone={() => setReviewing(null)} />
            )}
          </div>
        ))}
      </div>

      {activePrescription && (
        <PrescriptionModal
          prescription={activePrescription}
          onClose={() => setActivePrescription(null)}
        />
      )}
    </div>
  );
}
