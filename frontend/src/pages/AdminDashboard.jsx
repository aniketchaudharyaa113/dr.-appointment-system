import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatSlot } from "../lib/format";

const TABS = ["Overview", "Pending doctors", "All appointments"];

function StatCard({ label, value }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide text-inkSoft">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function OverviewTab({ token }) {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.getStats(token).then(setStats); }, [token]);
  if (!stats) return <p className="text-inkSoft">Loading…</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Total bookings" value={stats.totalBookings} />
      <StatCard label="Active doctors" value={stats.activeDoctors} />
      <StatCard label="Cancellations" value={stats.cancellations} />
    </div>
  );
}

function PendingDoctorsTab({ token }) {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.getPendingDoctors(token).then(setDoctors).finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function decide(id, approve) {
    await api.verifyDoctor(id, approve, token);
    load();
  }

  if (loading) return <p className="text-inkSoft">Loading…</p>;
  if (doctors.length === 0) return <p className="text-inkSoft">No pending doctors right now.</p>;

  return (
    <div className="space-y-3">
      {doctors.map((d) => (
        <div key={d.id} className="card flex items-center justify-between p-5">
          <div>
            <p className="font-display text-lg font-semibold text-ink">{d.name}</p>
            <p className="text-sm text-inkSoft">{d.specialty} · {d.clinic_name || "No clinic name set"}</p>
            <p className="text-sm text-inkSoft">{d.clinic_address}</p>
            <p className="mt-1 font-mono text-xs text-inkSoft">
              License: {d.license_number || "not provided"} · {d.email}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => decide(d.id, true)} className="btn-primary !py-1.5 text-xs">Approve</button>
            <button onClick={() => decide(d.id, false)} className="btn-secondary !py-1.5 text-xs">Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AllAppointmentsTab({ token }) {
  const [appointments, setAppointments] = useState([]);
  useEffect(() => { api.getAllAppointments(token).then(setAppointments); }, [token]);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-inkSoft">
          <tr>
            <th className="px-4 py-3">Ref</th>
            <th className="px-4 py-3">Patient</th>
            <th className="px-4 py-3">Doctor</th>
            <th className="px-4 py-3">Specialty</th>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => (
            <tr key={a.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3 font-mono text-xs text-sage-600">{a.booking_ref}</td>
              <td className="px-4 py-3">{a.patient_name}</td>
              <td className="px-4 py-3">{a.doctor_name}</td>
              <td className="px-4 py-3 text-inkSoft">{a.specialty}</td>
              <td className="px-4 py-3 font-mono text-xs">{formatSlot(a.slot_time)}</td>
              <td className="px-4 py-3 font-mono text-xs">{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminDashboard() {
  const { token } = useAuth();
  const [tab, setTab] = useState("Overview");

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-3xl font-semibold text-ink">Admin</h1>

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
        {tab === "Overview" && <OverviewTab token={token} />}
        {tab === "Pending doctors" && <PendingDoctorsTab token={token} />}
        {tab === "All appointments" && <AllAppointmentsTab token={token} />}
      </div>
    </div>
  );
}
