import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const [role, setRole] = useState("PATIENT");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.signup({ ...form, role });
      login(data.token, data.user);
      if (role === "DOCTOR") navigate("/doctor/dashboard");
      else navigate("/doctors");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-3xl font-semibold text-ink">Create your account</h1>
      <p className="mt-2 text-sm text-inkSoft">Book appointments or list your clinic.</p>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-card border border-line bg-white p-1">
        {["PATIENT", "DOCTOR"].map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`rounded-[8px] py-2 text-sm font-semibold transition-colors ${
              role === r ? "bg-sage-500 text-white" : "text-inkSoft hover:text-ink"
            }`}
          >
            {r === "PATIENT" ? "I'm a patient" : "I'm a doctor"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="card mt-6 space-y-4 p-6">
        {error && (
          <p className="rounded-card bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{error}</p>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-inkSoft">Full name</label>
          <input required className="input-field" value={form.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-inkSoft">Email</label>
          <input type="email" required className="input-field" value={form.email} onChange={(e) => update("email", e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-inkSoft">Phone (optional)</label>
          <input className="input-field" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-inkSoft">Password</label>
          <input type="password" required minLength={6} className="input-field" value={form.password} onChange={(e) => update("password", e.target.value)} />
        </div>

        {role === "DOCTOR" && (
          <p className="rounded-card bg-sage-50 px-3 py-2 text-xs text-sage-700">
            After signing up, you'll fill in your clinic details and submit them for admin
            verification before patients can find or book you.
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-inkSoft">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-sage-600">Log in</Link>
      </p>
    </div>
  );
}
