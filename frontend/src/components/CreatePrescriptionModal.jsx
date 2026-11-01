import { useState } from "react";
import { Plus, Trash2, X, Check } from "lucide-react";
import { api } from "../lib/api";

export default function CreatePrescriptionModal({ appointment, token, onCreated, onClose }) {
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [medicines, setMedicines] = useState([
    { name: "", dosage: "500mg", frequency: "1-0-1", duration: "5 days", instructions: "After food" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function addMedicineRow() {
    setMedicines((prev) => [
      ...prev,
      { name: "", dosage: "", frequency: "1-0-1", duration: "3 days", instructions: "After meals" },
    ]);
  }

  function updateMedicine(index, field, value) {
    setMedicines((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }

  function removeMedicine(index) {
    setMedicines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!diagnosis.trim()) {
      setError("Please enter a diagnosis");
      return;
    }
    const validMeds = medicines.filter((m) => m.name.trim() !== "");
    if (validMeds.length === 0) {
      setError("Please add at least one medicine name");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await api.createPrescription(
        {
          appointmentId: appointment.id,
          diagnosis,
          medicines: validMeds,
          notes,
        },
        token
      );
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-line bg-white shadow-2xl p-6 sm:p-7 my-6">
        <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
          <div>
            <h3 className="font-display font-semibold text-xl text-ink">Create Digital Prescription</h3>
            <p className="text-xs text-inkSoft mt-0.5">
              Patient: <span className="font-semibold text-ink">{appointment.patient_name}</span> · Token: {appointment.booking_ref}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-inkSoft hover:text-ink rounded-lg hover:bg-black/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <p className="mb-4 text-xs text-clay-600 bg-clay-500/10 p-2.5 rounded-lg">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink">Diagnosis / Clinical Findings *</label>
            <input
              className="input-field"
              placeholder="e.g. Acute Viral Bronchitis, Essential Hypertension..."
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-ink">Prescribed Medications *</label>
              <button
                type="button"
                onClick={addMedicineRow}
                className="text-xs font-semibold text-sage-600 hover:text-sage-700 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Medicine
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {medicines.map((m, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 p-2.5 border border-line rounded-lg bg-paperDim/40">
                  <input
                    className="input-field !w-40 flex-1 text-xs"
                    placeholder="Medicine name *"
                    value={m.name}
                    onChange={(e) => updateMedicine(idx, "name", e.target.value)}
                    required
                  />
                  <input
                    className="input-field !w-24 text-xs"
                    placeholder="Dosage (500mg)"
                    value={m.dosage}
                    onChange={(e) => updateMedicine(idx, "dosage", e.target.value)}
                  />
                  <input
                    className="input-field !w-24 text-xs font-mono"
                    placeholder="Freq (1-0-1)"
                    value={m.frequency}
                    onChange={(e) => updateMedicine(idx, "frequency", e.target.value)}
                  />
                  <input
                    className="input-field !w-24 text-xs"
                    placeholder="Duration"
                    value={m.duration}
                    onChange={(e) => updateMedicine(idx, "duration", e.target.value)}
                  />
                  <input
                    className="input-field !w-32 flex-1 text-xs"
                    placeholder="Instructions"
                    value={m.instructions}
                    onChange={(e) => updateMedicine(idx, "instructions", e.target.value)}
                  />
                  {medicines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeMedicine(idx)}
                      className="p-1.5 text-clay-500 hover:text-clay-700 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink">Clinical Notes & Advice (Optional)</label>
            <textarea
              className="input-field"
              rows={2}
              placeholder="e.g. Drink warm fluids, avoid heavy exertion, review in 7 days..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <button type="button" onClick={onClose} className="btn-secondary !py-2 text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary !py-2 text-xs flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> {loading ? "Saving…" : "Save & Issue Prescription"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
