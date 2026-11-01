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
      const check = await api.setAvailability(slots, token, true);
      if (check.affectedCount > 0) {
        const ok = window.confirm(
          `This schedule change will cancel ${check.affectedCount} existing booking(s) that no longer fit into your hours. Do you wish to proceed?`
        );
        if (!ok) {
          setSaving(false);
          return;
        }
      }
      const res = await api.setAvailability(slots, token, false);
      setMsg(
        res.affectedCount > 0
          ? `Weekly schedule updated. ${res.affectedCount} conflicting booking(s) were cancelled and patients notified.`
          : "Weekly schedule updated successfully."
      );
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
      const check = await api.addDoctorLeave(leaveDate, reason, token, true);
      if (check.affectedCount > 0) {
        const ok = window.confirm(
          `Scheduling leave on ${leaveDate} will cancel ${check.affectedCount} existing booking(s) and notify the patient(s). Do you wish to continue?`
        );
        if (!ok) {
          setLoading(false);
          return;
        }
      }
      const res = await api.addDoctorLeave(leaveDate, reason, token, false);
      setLeaveDate("");
      setReason("");
      setMsg(
        res.affectedCount > 0
          ? `Leave added. ${res.affectedCount} booking(s) cancelled and patients notified.`
          : "Leave added."
      );
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
  const [viewMode, setViewMode] = useState("all"); // "all" | "day"
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState({});
  const [prescribingAppt, setPrescribingAppt] = useState(null);
  const [viewingRx, setViewingRx] = useState(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    if (viewMode === "day") {
      api.getDoctorDayView(selectedDate, token)
        .then(setAppointments)
        .finally(() => setLoading(false));
    } else {
      api.getMyAppointments(token)
        .then(setAppointments)
        .finally(() => setLoading(false));
    }
  }
  useEffect(load, [token, viewMode, selectedDate]);

  async function complete(id) {
    await api.completeAppointment(id, notes[id] || "", token);
    load();
  }

  async function noShow(id) {
    if (!confirm("Are you sure you want to mark this patient as No-Show? This frees up the slot and notifies the patient.")) return;
    await api.markNoShow(id, token);
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
      {/* View Mode Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-lg border border-line">
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("all")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
              viewMode === "all" ? "bg-sage-600 text-white" : "bg-paperDim text-inkSoft hover:text-ink"
            }`}
          >
            All Appointments
          </button>
          <button
            onClick={() => setViewMode("day")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
              viewMode === "day" ? "bg-sage-600 text-white" : "bg-paperDim text-inkSoft hover:text-ink"
            }`}
          >
            Day View (Schedule)
          </button>
        </div>

        {viewMode === "day" && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-ink">Date:</label>
            <input
              type="date"
              className="input-field text-xs py-1 px-2.5 font-mono"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading && <p className="text-inkSoft text-xs">Loading appointments…</p>}

      {!loading && appointments.length === 0 && (
        <p className="text-inkSoft text-xs">
          {viewMode === "day" ? `No appointments scheduled for ${selectedDate}.` : "No appointments scheduled."}
        </p>
      )}

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
              appt.status === "COMPLETED" ? "bg-line text-inkSoft" :
              appt.status === "NO_SHOW" ? "bg-amber-50 text-amber-800 border border-amber-200" :
              "bg-clay-50 text-clay-700"
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
                  onClick={() => noShow(appt.id)}
                  className="btn-secondary !py-1.5 text-xs text-amber-700 hover:text-amber-900 border-amber-200"
                >
                  Mark No-Show
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
  const [chartMode, setChartMode] = useState("weekly"); // "weekly" | "monthly"

  useEffect(() => { api.getMyEarnings(token).then(setEarnings); }, [token]);
  if (!earnings) return <p className="text-inkSoft">Loading…</p>;

  const activeSeries = chartMode === "weekly" ? (earnings.weekly || []) : (earnings.monthly || []);
  const maxVal = Math.max(...activeSeries.map((s) => s.earnings), 1);

  return (
    <div className="space-y-6">
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

      {/* Chart by Week / Month */}
      <div className="card p-6 bg-white border border-line space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-ink">Earnings Breakdown</h3>
          <div className="flex gap-1 bg-paperDim p-0.5 rounded-lg border border-line">
            <button
              onClick={() => setChartMode("weekly")}
              className={`px-3 py-1 rounded text-xs font-semibold ${
                chartMode === "weekly" ? "bg-white shadow-xs text-ink" : "text-inkSoft hover:text-ink"
              }`}
            >
              By Week
            </button>
            <button
              onClick={() => setChartMode("monthly")}
              className={`px-3 py-1 rounded text-xs font-semibold ${
                chartMode === "monthly" ? "bg-white shadow-xs text-ink" : "text-inkSoft hover:text-ink"
              }`}
            >
              By Month
            </button>
          </div>
        </div>

        {activeSeries.length === 0 ? (
          <p className="text-xs text-inkSoft py-4 text-center">No completed consultations in this period.</p>
        ) : (
          <div className="space-y-3 pt-2">
            {activeSeries.map((item) => {
              const pct = Math.max(8, Math.round((item.earnings / maxVal) * 100));
              return (
                <div key={item.period} className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="font-medium text-ink">{item.period}</span>
                    <span className="text-sage-700 font-semibold">
                      ₹{item.earnings} <span className="text-inkSoft font-normal">({item.count} visits)</span>
                    </span>
                  </div>
                  <div className="w-full h-3 bg-paperDim rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sage-500 rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
