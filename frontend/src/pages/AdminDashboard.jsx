import { useEffect, useState } from "react";
import { Search, ShieldAlert, CheckCircle, XCircle, Activity, UserCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatSlot } from "../lib/format";

const TABS = ["Overview", "Pending doctors", "All appointments", "System Audit Logs"];

function StatCard({ label, value, color = "text-ink" }) {
  return (
    <div className="card p-5 bg-white border border-line shadow-sm">
      <p className="text-xs uppercase tracking-wider font-semibold text-inkSoft">{label}</p>
      <p className={`mt-2 font-display text-4xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function OverviewTab({ token }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.getStats(token).then(setStats);
  }, [token]);

  if (!stats) return <p className="text-inkSoft">Loading stats…</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Total Bookings" value={stats.totalBookings} color="text-sage-700" />
      <StatCard label="Active Doctors" value={stats.activeDoctors} color="text-ink" />
      <StatCard label="Registered Patients" value={stats.totalPatients || 0} color="text-ink" />
      <StatCard label="Cancellations" value={stats.cancellations} color="text-clay-600" />
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
    if (!confirm(`Are you sure you want to ${approve ? "APPROVE" : "REJECT"} this doctor?`)) return;
    await api.verifyDoctor(id, approve, token);
    load();
  }

  if (loading) return <p className="text-inkSoft">Loading pending doctors…</p>;
  if (doctors.length === 0) {
    return (
      <div className="card p-10 text-center text-inkSoft bg-white border border-line">
        <UserCheck className="w-8 h-8 mx-auto mb-2 text-sage-600" />
        No pending doctor applications right now. All caught up!
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {doctors.map((d) => (
        <div key={d.id} className="card flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 bg-white border border-line gap-4 shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold text-ink">{d.name}</span>
              <span className="font-mono text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                PENDING
              </span>
            </div>
            <p className="text-sm text-inkSoft font-medium mt-0.5">
              {d.specialty} · {d.clinic_name || "No clinic name"}
            </p>
            <p className="text-xs text-inkSoft mt-0.5">{d.clinic_address || "No address entered"}</p>
            <p className="mt-1 font-mono text-xs text-inkSoft">
              License: <span className="font-semibold text-ink">{d.license_number || "Not provided"}</span> · {d.email} · {d.phone || "No phone"}
            </p>
            {d.qualifications && (
              <p className="text-xs text-inkSoft mt-0.5">Qualifications: {d.qualifications} ({d.experience_years} yrs exp)</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => decide(d.id, true)} className="btn-primary !py-1.5 text-xs flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> Approve
            </button>
            <button onClick={() => decide(d.id, false)} className="btn-secondary !py-1.5 text-xs text-clay-600 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AllAppointmentsTab({ token }) {
  const [appointments, setAppointments] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    const params = {};
    if (search.trim()) params.q = search.trim();
    if (status) params.status = status;
    api.getAllAppointments(params, token)
      .then(setAppointments)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [token, status]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    load();
  }

  async function handleAdminCancel(id, ref) {
    const reason = prompt(`Enter reason for administrative cancellation of ${ref}:`);
    if (reason === null) return;
    await api.cancelAppointment(id, token, reason || "Cancelled by Admin");
    load();
  }

  return (
    <div className="space-y-4">
      {/* Search & Filter bar */}
      <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-2 items-center bg-white p-3 rounded-xl border border-line">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-inkSoft" />
          <input
            className="input-field !pl-9 text-xs"
            placeholder="Search by token, patient name, doctor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input-field !w-40 text-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
        <button type="submit" className="btn-primary !py-2 text-xs">
          Filter
        </button>
      </form>

      <div className="card overflow-x-auto bg-white border border-line">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-paperDim/50 text-xs uppercase tracking-wide text-inkSoft font-mono">
            <tr>
              <th className="px-4 py-3">Ref</th>
              <th className="px-4 py-3">Patient</th>
              <th className="px-4 py-3">Doctor</th>
              <th className="px-4 py-3">Specialty</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {appointments.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-xs text-inkSoft">
                  {loading ? "Loading appointments…" : "No appointments found."}
                </td>
              </tr>
            ) : (
              appointments.map((a) => (
                <tr key={a.id} className="hover:bg-paperDim/30">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-sage-600">{a.booking_ref}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-xs text-ink">{a.patient_name}</p>
                    <p className="text-[10px] text-inkSoft font-mono">{a.patient_email}</p>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-ink">{a.doctor_name}</td>
                  <td className="px-4 py-3 text-xs text-inkSoft">{a.specialty}</td>
                  <td className="px-4 py-3 font-mono text-xs text-inkSoft">{formatSlot(a.slot_time)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-mono font-medium ${
                      a.status === "CONFIRMED" ? "bg-sage-50 text-sage-700" :
                      a.status === "COMPLETED" ? "bg-line text-inkSoft" : "bg-clay-50 text-clay-700"
                    }`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.status === "CONFIRMED" && (
                      <button
                        onClick={() => handleAdminCancel(a.id, a.booking_ref)}
                        className="text-xs text-clay-600 hover:text-clay-800 font-semibold"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditLogsTab({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAuditLogs(token)
      .then(setLogs)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <p className="text-inkSoft">Loading audit logs…</p>;

  return (
    <div className="card bg-white border border-line overflow-x-auto">
      <div className="p-4 border-b border-line flex items-center gap-2">
        <Activity className="w-4 h-4 text-sage-600" />
        <h3 className="font-display font-semibold text-sm text-ink">System Audit Trail</h3>
      </div>
      <table className="w-full text-left text-xs">
        <thead className="bg-paperDim border-b border-line text-inkSoft font-mono uppercase">
          <tr>
            <th className="p-3">Timestamp</th>
            <th className="p-3">Action</th>
            <th className="p-3">Actor</th>
            <th className="p-3">Role</th>
            <th className="p-3">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {logs.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-6 text-center text-inkSoft">No audit records logged yet.</td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id} className="hover:bg-paperDim/30">
                <td className="p-3 font-mono text-inkSoft whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="p-3 font-mono font-bold text-sage-700">{log.action}</td>
                <td className="p-3 font-medium text-ink">{log.actor_name || "System"}</td>
                <td className="p-3 font-mono text-[11px] text-inkSoft">{log.actor_role}</td>
                <td className="p-3 font-mono text-[11px] text-inkSoft truncate max-w-xs">
                  {typeof log.details === "object" ? JSON.stringify(log.details) : log.details || "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminDashboard() {
  const { token } = useAuth();
  const [tab, setTab] = useState("Overview");

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Admin Operations Center</h1>
          <p className="text-sm text-inkSoft mt-1">Review credentials, monitor system metrics, and oversee platform appointments.</p>
        </div>
      </div>

      <div className="mt-6 flex gap-1 rounded-card border border-line bg-white p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 min-w-[130px] rounded-[8px] py-2 text-xs font-semibold transition-colors ${
              tab === t ? "bg-sage-500 text-white shadow-sm" : "text-inkSoft hover:text-ink"
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
        {tab === "System Audit Logs" && <AuditLogsTab token={token} />}
      </div>
    </div>
  );
}
