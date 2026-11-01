import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatSlot } from "../lib/format";
import { SPECIALTIES } from "../lib/specialties";
import CreatePrescriptionModal from "../components/CreatePrescriptionModal";
import PrescriptionModal from "../components/PrescriptionModal";
import { Plus, Trash2, Calendar, FileText, CheckCircle2 } from "lucide-react";

const TABS = ["Profile", "Availability", "Leaves & Blackouts", "Appointments", "Earnings"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ProfileTab({ token }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.getMyDoctorProfile(token).then((d) =>
      setForm({
        specialty: d.specialty === "Not set" ? "" : d.specialty,
        qualifications: d.qualifications || "",
        experienceYears: d.experience_years || 0,
        clinicName: d.clinic_name || "",
        clinicAddress: d.clinic_address || "",
        clinicLat: d.clinic_lat || "",
        clinicLng: d.clinic_lng || "",
        consultationFee: d.consultation_fee || "",
        licenseNumber: d.license_number || "",
        isVerified: d.is_verified,
      })
    );
  }, [token]);

  if (!form) return <p className="text-inkSoft">Loading…</p>;

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      await api.updateMyDoctorProfile(form, token);
      setMsg("Profile saved successfully.");
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition((pos) => {
      update("clinicLat", pos.coords.latitude.toFixed(6));
      update("clinicLng", pos.coords.longitude.toFixed(6));
    });
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-6 bg-white border border-line">
      <div className={`rounded-card px-3.5 py-2.5 text-xs font-medium flex items-center justify-between ${
        form.isVerified ? "bg-sage-50 text-sage-700 border border-sage-200" : "bg-amber-50 text-amber-800 border border-amber-200"
      }`}>
        <span>
          {form.isVerified
            ? "✓ Your clinic is verified and publicly searchable."
            : "⏳ Pending admin verification — once verified, your clinic will appear in patient searches."}
        </span>
        <span className="font-mono uppercase text-[10px] px-2 py-0.5 rounded bg-white font-bold">
          {form.isVerified ? "ACTIVE" : "PENDING"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink">Specialty</label>
          <select
            className="input-field"
            value={form.specialty}
            onChange={(e) => update("specialty", e.target.value)}
          >
            <option value="" disabled>Select a specialty…</option>
            {SPECIALTIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <Field label="Qualifications" value={form.qualifications} onChange={(v) => update("qualifications", v)} placeholder="e.g. MBBS, MD, MS" />
        <Field label="Experience (years)" type="number" value={form.experienceYears} onChange={(v) => update("experienceYears", v)} />
        <Field label="Consultation fee (₹)" type="number" value={form.consultationFee} onChange={(v) => update("consultationFee", v)} />
        <Field label="Clinic name" value={form.clinicName} onChange={(v) => update("clinicName", v)} />
        <Field label="Medical License / Registration No." value={form.licenseNumber} onChange={(v) => update("licenseNumber", v)} />
      </div>

      <Field label="Clinic address" value={form.clinicAddress} onChange={(v) => update("clinicAddress", v)} />

      <div>
        <div className="flex items-center justify-between">
          <label className="mb-1 block text-xs font-semibold text-ink">
            Clinic Coordinates (used to calculate distance in symptom search)
          </label>
          <button type="button" onClick={useMyLocation} className="text-xs font-semibold text-sage-600 hover:underline">
            Use my current GPS location
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input className="input-field font-mono text-xs" placeholder="Latitude (e.g. 22.5726)" value={form.clinicLat} onChange={(e) => update("clinicLat", e.target.value)} />
          <input className="input-field font-mono text-xs" placeholder="Longitude (e.g. 88.3639)" value={form.clinicLng} onChange={(e) => update("clinicLng", e.target.value)} />
        </div>
      </div>

      <div className="pt-2 flex items-center justify-between">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save profile"}
        </button>
        {msg && <p className="text-sm text-sage-600 font-medium">{msg}</p>}
      </div>
    </form>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink">{label}</label>
      <input type={type} className="input-field" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AvailabilityTab({ token }) {
  const [rows, setRows] = useState(
    DAY_NAMES.map((_, i) => ({ dayOfWeek: i, enabled: false, startTime: "09:00", endTime: "17:00", slotDurationMinutes: 15 }))
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.getMyDoctorProfile(token).then((d) => {
      if (!d.availability?.length) return;
      setRows((prev) =>
        prev.map((row) => {
          const match = d.availability.find((a) => a.day_of_week === row.dayOfWeek);
          return match
            ? { ...row, enabled: true, startTime: match.start_time.slice(0, 5), endTime: match.end_time.slice(0, 5), slotDurationMinutes: match.slot_duration_minutes }
            : row;
        })
      );
    });
  }, [token]);

  function updateRow(i, field, value) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const slots = rows.filter((r) => r.enabled).map(({ enabled, ...rest }) => rest);
      await api.setAvailability(slots, token);
      setMsg("Weekly schedule updated successfully.");
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6 bg-white border border-line">
      <p className="text-xs text-inkSoft mb-4">Set which days and hours your clinic is open for consultations.</p>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={row.dayOfWeek} className="flex flex-wrap items-center gap-3 border-b border-line pb-3 last:border-0">
            <label className="flex w-32 items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={row.enabled} onChange={(e) => updateRow(i, "enabled", e.target.checked)} className="rounded text-sage-600 focus:ring-sage-500" />
              {DAY_NAMES[row.dayOfWeek]}
            </label>
            <input type="time" disabled={!row.enabled} value={row.startTime} onChange={(e) => updateRow(i, "startTime", e.target.value)} className="input-field !w-32 disabled:opacity-40" />
            <span className="text-inkSoft text-xs">to</span>
            <input type="time" disabled={!row.enabled} value={row.endTime} onChange={(e) => updateRow(i, "endTime", e.target.value)} className="input-field !w-32 disabled:opacity-40" />
            <select disabled={!row.enabled} value={row.slotDurationMinutes} onChange={(e) => updateRow(i, "slotDurationMinutes", Number(e.target.value))} className="input-field !w-28 disabled:opacity-40">
              {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} mins</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save schedule"}
        </button>
        {msg && <p className="text-sm text-sage-600 font-medium">{msg}</p>}
      </div>
    </div>
  );
}

function LeavesTab({ token }) {
  const [leaves, setLeaves] = useState([]);
  const [leaveDate, setLeaveDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    api.getMyDoctorProfile(token).then((d) => setLeaves(d.leaves || []));
  }
  useEffect(load, [token]);

  async function addLeave(e) {
    e.preventDefault();
    if (!leaveDate) return;
    setLoading(true);
    setMsg("");
    try {
      await api.addDoctorLeave(leaveDate, reason, token);
      setLeaveDate("");
      setReason("");
      setMsg("Leave added.");
      load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function removeLeave(date) {
    await api.removeDoctorLeave(date, token);
    load();
  }

  return (
    <div className="card p-6 bg-white border border-line space-y-6">
      <div>
        <h3 className="font-display font-semibold text-lg text-ink">Manage Leave & Blackout Dates</h3>
        <p className="text-xs text-inkSoft mt-1">
          Block dates when you are unavailable (e.g. conference, vacation, personal leave). Patients cannot book slots on these dates.
        </p>
      </div>

      <form onSubmit={addLeave} className="flex flex-wrap gap-3 items-end p-4 rounded-xl bg-paperDim/50 border border-line">
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">Date</label>
          <input
            type="date"
            min={new Date().toISOString().split("T")[0]}
            value={leaveDate}
            onChange={(e) => setLeaveDate(e.target.value)}
            className="input-field !w-44 text-xs"
            required
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-ink mb-1">Reason / Note (optional)</label>
          <input
            type="text"
            placeholder="e.g. Attending Annual Cardiology Summit"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input-field text-xs"
          />
        </div>
        <button type="submit" disabled={loading} className="btn-primary !py-2 text-xs flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> {loading ? "Adding…" : "Block Date"}
        </button>
      </form>
      {msg && <p className="text-xs text-sage-600">{msg}</p>}

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">Scheduled Blackout Dates</h4>
        {leaves.length === 0 ? (
          <p className="text-xs text-inkSoft">No leaves scheduled.</p>
        ) : (
          <div className="divide-y divide-line border border-line rounded-lg overflow-hidden">
            {leaves.map((l) => (
              <div key={l.leave_date || l.id} className="flex items-center justify-between p-3 bg-white hover:bg-paperDim/20">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-sage-600" />
                  <span className="font-mono text-xs font-semibold text-ink">
                    {String(l.leave_date).slice(0, 10)}
                  </span>
                  {l.reason && <span className="text-xs text-inkSoft">({l.reason})</span>}
                </div>
                <button
                  onClick={() => removeLeave(String(l.leave_date).slice(0, 10))}
                  className="text-xs text-clay-600 hover:text-clay-800 p-1 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AppointmentsTab({ token }) {
  const [appointments, setAppointments] = useState([]);
  const [notes, setNotes] = useState({});
  const [prescribingAppt, setPrescribingAppt] = useState(null);
  const [viewingRx, setViewingRx] = useState(null);

  function load() {
    api.getMyAppointments(token).then(setAppointments);
  }
  useEffect(load, [token]);

  async function complete(id) {
    await api.completeAppointment(id, notes[id] || "", token);
    load();
  }

  async function cancel(id) {
    const reason = prompt("Enter reason for cancelling this patient's appointment:");
    if (reason === null) return;
    await api.cancelAppointment(id, token, reason || "Doctor unavailable");
    load();
  }

  async function viewRx(appointmentId) {
    try {
      const rx = await api.getPrescriptionByAppointment(appointmentId, token);
      setViewingRx(rx);
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-4">
      {appointments.length === 0 && <p className="text-inkSoft">No appointments scheduled.</p>}
      {appointments.map((appt) => (
        <div key={appt.id} className="card p-5 bg-white border border-line shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-xs font-bold text-sage-600 bg-sage-50 px-2 py-0.5 rounded border border-sage-200">
                {appt.booking_ref}
              </span>
              <p className="font-display text-lg font-bold text-ink mt-1">{appt.patient_name}</p>
              <p className="font-mono text-xs text-inkSoft font-medium">{formatSlot(appt.slot_time)}</p>
              <div className="mt-1 text-xs text-inkSoft flex items-center gap-3">
                {appt.patient_phone && <span>📞 {appt.patient_phone}</span>}
                {appt.patient_email && <span>✉️ {appt.patient_email}</span>}
              </div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-mono font-medium ${
              appt.status === "CONFIRMED" ? "bg-sage-50 text-sage-700" :
              appt.status === "COMPLETED" ? "bg-line text-inkSoft" : "bg-clay-50 text-clay-700"
            }`}>
              {appt.status}
            </span>
          </div>

          {appt.status === "CONFIRMED" && (
            <div className="mt-4 border-t border-line/60 pt-3 space-y-2">
              <textarea
                placeholder="Consultation notes / observations (optional)"
                className="input-field text-xs"
                rows={2}
                value={notes[appt.id] || ""}
                onChange={(e) => setNotes((n) => ({ ...n, [appt.id]: e.target.value }))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => complete(appt.id)} className="btn-primary !py-1.5 text-xs">
                  Mark Completed
                </button>
                <button
                  onClick={() => setPrescribingAppt(appt)}
                  className="btn-secondary !py-1.5 text-xs flex items-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5" /> Issue Prescription
                </button>
                <button onClick={() => cancel(appt.id)} className="btn-secondary !py-1.5 text-xs text-clay-600">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {appt.prescription_id && (
            <div className="mt-3 pt-2 border-t border-line/50 flex items-center justify-between">
              <span className="text-xs font-medium text-sage-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Prescription Issued
              </span>
              <button
                onClick={() => viewRx(appt.id)}
                className="text-xs font-semibold text-sage-600 hover:underline"
              >
                View Prescription Document →
              </button>
            </div>
          )}

          {appt.notes && <p className="mt-2 text-xs text-inkSoft bg-paperDim p-2 rounded">Notes: {appt.notes}</p>}
        </div>
      ))}

      {prescribingAppt && (
        <CreatePrescriptionModal
          appointment={prescribingAppt}
          token={token}
          onCreated={load}
          onClose={() => setPrescribingAppt(null)}
        />
      )}

      {viewingRx && (
        <PrescriptionModal
          prescription={viewingRx}
          onClose={() => setViewingRx(null)}
        />
      )}
    </div>
  );
}

function EarningsTab({ token }) {
  const [earnings, setEarnings] = useState(null);
  useEffect(() => { api.getMyEarnings(token).then(setEarnings); }, [token]);
  if (!earnings) return <p className="text-inkSoft">Loading…</p>;

  return (
    <div className="card p-8 text-center bg-white border border-line">
      <p className="text-xs uppercase tracking-wider font-semibold text-inkSoft">Revenue Analytics</p>
      <p className="mt-1 text-sm text-inkSoft">Total earnings from completed consultations</p>
      <p className="mt-3 font-display text-5xl font-bold text-sage-600">
        ₹{Number(earnings.total_earnings).toFixed(0)}
      </p>
      <p className="mt-2 font-mono text-xs text-inkSoft">
        Based on {earnings.completed_appointments} completed appointment{earnings.completed_appointments === "1" ? "" : "s"}
      </p>
    </div>
  );
}

export default function DoctorDashboard() {
  const { token } = useAuth();
  const [tab, setTab] = useState("Profile");

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl font-semibold text-ink">Doctor Portal</h1>

      <div className="mt-6 flex gap-1 rounded-card border border-line bg-white p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 min-w-[120px] rounded-[8px] py-2 text-xs font-semibold transition-colors ${
              tab === t ? "bg-sage-500 text-white shadow-sm" : "text-inkSoft hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "Profile" && <ProfileTab token={token} />}
        {tab === "Availability" && <AvailabilityTab token={token} />}
        {tab === "Leaves & Blackouts" && <LeavesTab token={token} />}
        {tab === "Appointments" && <AppointmentsTab token={token} />}
        {tab === "Earnings" && <EarningsTab token={token} />}
      </div>
    </div>
  );
}
