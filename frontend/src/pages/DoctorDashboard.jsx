import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatSlot } from "../lib/format";
import { SPECIALTIES } from "../lib/specialties";

const TABS = ["Profile", "Availability", "Appointments", "Earnings"];
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
      setMsg("Saved.");
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
    <form onSubmit={save} className="card space-y-4 p-6">
      <div className={`rounded-card px-3 py-2 text-xs ${form.isVerified ? "bg-sage-50 text-sage-700" : "bg-clay-400/10 text-clay-600"}`}>
        {form.isVerified
          ? "Your clinic is verified and visible to patients."
          : "Pending admin verification — you won't appear in search until approved."}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-inkSoft">Specialty</label>
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
        <Field label="Qualifications" value={form.qualifications} onChange={(v) => update("qualifications", v)} />
        <Field label="Experience (years)" type="number" value={form.experienceYears} onChange={(v) => update("experienceYears", v)} />
        <Field label="Consultation fee (₹)" type="number" value={form.consultationFee} onChange={(v) => update("consultationFee", v)} />
        <Field label="Clinic name" value={form.clinicName} onChange={(v) => update("clinicName", v)} />
        <Field label="License / registration no." value={form.licenseNumber} onChange={(v) => update("licenseNumber", v)} />
      </div>

      <Field label="Clinic address" value={form.clinicAddress} onChange={(v) => update("clinicAddress", v)} />

      <div>
        <div className="flex items-center justify-between">
          <label className="mb-1 block text-xs font-medium text-inkSoft">Clinic coordinates (for symptom search distance)</label>
          <button type="button" onClick={useMyLocation} className="text-xs font-semibold text-sage-600">
            Use my current location
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input className="input-field" placeholder="Latitude" value={form.clinicLat} onChange={(e) => update("clinicLat", e.target.value)} />
          <input className="input-field" placeholder="Longitude" value={form.clinicLng} onChange={(e) => update("clinicLng", e.target.value)} />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? "Saving…" : "Save profile"}
      </button>
      {msg && <p className="text-sm text-inkSoft">{msg}</p>}
    </form>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-inkSoft">{label}</label>
      <input type={type} className="input-field" value={value} onChange={(e) => onChange(e.target.value)} />
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
      setMsg("Availability updated.");
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={row.dayOfWeek} className="flex flex-wrap items-center gap-3 border-b border-line pb-3 last:border-0">
            <label className="flex w-32 items-center gap-2 text-sm">
              <input type="checkbox" checked={row.enabled} onChange={(e) => updateRow(i, "enabled", e.target.checked)} />
              {DAY_NAMES[row.dayOfWeek]}
            </label>
            <input type="time" disabled={!row.enabled} value={row.startTime} onChange={(e) => updateRow(i, "startTime", e.target.value)} className="input-field !w-32 disabled:opacity-40" />
            <span className="text-inkSoft">to</span>
            <input type="time" disabled={!row.enabled} value={row.endTime} onChange={(e) => updateRow(i, "endTime", e.target.value)} className="input-field !w-32 disabled:opacity-40" />
            <select disabled={!row.enabled} value={row.slotDurationMinutes} onChange={(e) => updateRow(i, "slotDurationMinutes", Number(e.target.value))} className="input-field !w-28 disabled:opacity-40">
              {[10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
        ))}
      </div>
      <button onClick={save} disabled={saving} className="btn-primary mt-4">
        {saving ? "Saving…" : "Save availability"}
      </button>
      {msg && <p className="mt-2 text-sm text-inkSoft">{msg}</p>}
    </div>
  );
}

function AppointmentsTab({ token }) {
  const [appointments, setAppointments] = useState([]);
  const [notes, setNotes] = useState({});

  function load() {
    api.getMyAppointments(token).then(setAppointments);
  }
  useEffect(load, [token]);

  async function complete(id) {
    await api.completeAppointment(id, notes[id] || "", token);
    load();
  }
  async function cancel(id) {
    if (!confirm("Cancel this appointment?")) return;
    await api.cancelAppointment(id, token);
    load();
  }

  return (
    <div className="space-y-4">
      {appointments.length === 0 && <p className="text-inkSoft">No appointments yet.</p>}
      {appointments.map((appt) => (
        <div key={appt.id} className="card p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-xs text-sage-600">{appt.booking_ref}</p>
              <p className="font-display text-lg font-semibold text-ink">{appt.patient_name}</p>
              <p className="font-mono text-sm text-inkSoft">{formatSlot(appt.slot_time)}</p>
              {appt.patient_phone && <p className="text-xs text-inkSoft">{appt.patient_phone}</p>}
            </div>
            <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-mono text-inkSoft">{appt.status}</span>
          </div>

          {appt.status === "CONFIRMED" && (
            <div className="mt-3 space-y-2">
              <textarea
                placeholder="Visit notes (optional)"
                className="input-field"
                rows={2}
                value={notes[appt.id] || ""}
                onChange={(e) => setNotes((n) => ({ ...n, [appt.id]: e.target.value }))}
              />
              <div className="flex gap-2">
                <button onClick={() => complete(appt.id)} className="btn-primary !py-1.5 text-xs">Mark completed</button>
                <button onClick={() => cancel(appt.id)} className="btn-secondary !py-1.5 text-xs">Cancel</button>
              </div>
            </div>
          )}
          {appt.notes && <p className="mt-2 text-sm text-inkSoft">Notes: {appt.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function EarningsTab({ token }) {
  const [earnings, setEarnings] = useState(null);
  useEffect(() => { api.getMyEarnings(token).then(setEarnings); }, [token]);
  if (!earnings) return <p className="text-inkSoft">Loading…</p>;

  return (
    <div className="card p-8 text-center">
      <p className="text-sm text-inkSoft">Total earnings from completed appointments</p>
      <p className="mt-2 font-display text-4xl font-semibold text-sage-600">
        ₹{Number(earnings.total_earnings).toFixed(0)}
      </p>
      <p className="mt-1 font-mono text-xs text-inkSoft">
        {earnings.completed_appointments} completed appointment{earnings.completed_appointments === "1" ? "" : "s"}
      </p>
    </div>
  );
}

export default function DoctorDashboard() {
  const { token } = useAuth();
  const [tab, setTab] = useState("Profile");

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl font-semibold text-ink">Doctor dashboard</h1>

      <div className="mt-6 flex gap-1 rounded-card border border-line bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-[8px] py-2 text-sm font-semibold transition-colors ${
              tab === t ? "bg-sage-500 text-white" : "text-inkSoft hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "Profile" && <ProfileTab token={token} />}
        {tab === "Availability" && <AvailabilityTab token={token} />}
        {tab === "Appointments" && <AppointmentsTab token={token} />}
        {tab === "Earnings" && <EarningsTab token={token} />}
      </div>
    </div>
  );
}
