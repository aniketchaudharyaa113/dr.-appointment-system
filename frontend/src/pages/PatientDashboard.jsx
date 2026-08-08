import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import StarRating from "../components/StarRating";
import { formatSlot } from "../lib/format";

function StatusBadge({ status }) {
  const styles = {
    CONFIRMED: "bg-sage-50 text-sage-700",
    COMPLETED: "bg-line text-inkSoft",
    CANCELLED: "bg-clay-500/10 text-clay-600",
    PENDING: "bg-clay-400/10 text-clay-500",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-mono ${styles[status] || ""}`}>
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
      await api.createReview({ doctorId: appt.doctor_id, rating, comment }, token);
      setMsg("Thanks for the review!");
      onDone?.();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-card border border-dashed border-line p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-inkSoft">Your rating:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className="text-lg leading-none">
            <span className={n <= rating ? "text-clay-500" : "text-line"}>★</span>
          </button>
        ))}
      </div>
      <textarea
        className="input-field mt-2"
        rows={2}
        placeholder="How was the visit? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button onClick={submit} disabled={submitting} className="btn-secondary mt-2 !py-1.5 text-xs">
        {submitting ? "Submitting…" : "Submit review"}
      </button>
      {msg && <p className="mt-1 text-xs text-inkSoft">{msg}</p>}
    </div>
  );
}

export default function PatientDashboard() {
  const { token } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null);

  function load() {
    setLoading(true);
    api.getMyAppointments(token).then(setAppointments).finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function handleCancel(id) {
    if (!confirm("Cancel this appointment?")) return;
    await api.cancelAppointment(id, token);
    load();
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl font-semibold text-ink">My appointments</h1>

      {loading && <p className="mt-6 text-inkSoft">Loading…</p>}
      {!loading && appointments.length === 0 && (
        <div className="card mt-6 p-10 text-center text-inkSoft">
          You haven't booked anything yet.
        </div>
      )}

      <div className="mt-6 space-y-4">
        {appointments.map((appt) => (
          <div key={appt.id} className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs text-sage-600">{appt.booking_ref}</p>
                <p className="font-display text-lg font-semibold text-ink">{appt.doctor_name}</p>
                <p className="text-sm text-inkSoft">{appt.specialty} · {appt.clinic_name}</p>
                <p className="mt-1 font-mono text-sm text-ink">
                  {formatSlot(appt.slot_time)}
                </p>
              </div>
              <StatusBadge status={appt.status} />
            </div>

            {(appt.clinic_address || (appt.clinic_lat && appt.clinic_lng)) && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card bg-paperDim px-3 py-2">
                <p className="text-sm text-inkSoft">{appt.clinic_address}</p>
                <a
                  href={
                    appt.clinic_lat && appt.clinic_lng
                      ? `https://www.google.com/maps/dir/?api=1&destination=${appt.clinic_lat},${appt.clinic_lng}`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appt.clinic_address)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="whitespace-nowrap text-xs font-semibold text-sage-600 underline underline-offset-2"
                >
                  Get directions →
                </a>
              </div>
            )}

            {appt.notes && (
              <p className="mt-3 rounded-card bg-paperDim px-3 py-2 text-sm text-inkSoft">
                Doctor's notes: {appt.notes}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              {appt.status === "CONFIRMED" && (
                <button onClick={() => handleCancel(appt.id)} className="btn-secondary !py-1.5 text-xs">
                  Cancel
                </button>
              )}
              {appt.status === "COMPLETED" && reviewing !== appt.id && (
                <button onClick={() => setReviewing(appt.id)} className="btn-secondary !py-1.5 text-xs">
                  Leave a review
                </button>
              )}
            </div>

            {reviewing === appt.id && (
              <ReviewForm appt={appt} token={token} onDone={() => setReviewing(null)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
