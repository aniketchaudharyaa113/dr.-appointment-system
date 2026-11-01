import { Printer, X, FileText } from "lucide-react";
import { formatSlot } from "../lib/format";

export default function PrescriptionModal({ prescription, onClose }) {
  if (!prescription) return null;

  const meds = Array.isArray(prescription.medicines)
    ? prescription.medicines
    : typeof prescription.medicines === "string"
    ? JSON.parse(prescription.medicines || "[]")
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl rounded-2xl border border-line bg-white shadow-2xl p-6 sm:p-8 my-8 print:p-0 print:border-none print:shadow-none">
        {/* Action Header (Hidden in Print) */}
        <div className="flex items-center justify-between border-b border-line pb-4 print:hidden">
          <div className="flex items-center gap-2 text-sage-700">
            <FileText className="w-5 h-5" />
            <span className="font-display font-semibold text-lg">Digital Medical Prescription</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" /> Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-inkSoft hover:text-ink rounded-lg hover:bg-black/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Prescription Document Content */}
        <div className="mt-6 border-2 border-sage-600/30 rounded-xl p-6 print:border-none print:p-0">
          {/* Clinic & Doctor Header */}
          <div className="flex flex-col sm:flex-row justify-between border-b-2 border-sage-600/30 pb-4 gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink">{prescription.doctor_name}</h2>
              <p className="text-sm font-medium text-sage-700">{prescription.specialty}</p>
              <p className="text-xs text-inkSoft">{prescription.qualifications}</p>
              {prescription.license_number && (
                <p className="font-mono text-xs text-inkSoft mt-0.5">
                  Reg No: {prescription.license_number}
                </p>
              )}
            </div>
            <div className="text-left sm:text-right">
              <h3 className="font-display font-semibold text-ink text-sm">{prescription.clinic_name}</h3>
              <p className="text-xs text-inkSoft max-w-xs">{prescription.clinic_address}</p>
              <p className="font-mono text-xs text-sage-600 font-bold mt-1">
                Ref: {prescription.booking_ref}
              </p>
            </div>
          </div>

          {/* Patient Details & Date */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-4 bg-paperDim p-3 rounded-lg text-xs">
            <div>
              <span className="text-inkSoft block">Patient Name:</span>
              <span className="font-semibold text-ink">{prescription.patient_name}</span>
            </div>
            <div>
              <span className="text-inkSoft block">Date & Slot:</span>
              <span className="font-mono text-ink">{formatSlot(prescription.slot_time)}</span>
            </div>
            <div>
              <span className="text-inkSoft block">Prescription ID:</span>
              <span className="font-mono text-ink">{prescription.id?.slice(0, 8)}</span>
            </div>
          </div>

          {/* Diagnosis */}
          <div className="mb-5">
            <h4 className="font-display font-semibold text-sm text-ink mb-1">Clinical Diagnosis:</h4>
            <div className="p-2.5 rounded-lg border border-line bg-white text-sm text-ink font-medium">
              {prescription.diagnosis}
            </div>
          </div>

          {/* Rx Medications */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-serif italic font-bold text-xl text-sage-700">℞</span>
              <h4 className="font-display font-semibold text-sm text-ink">Prescribed Medications:</h4>
            </div>

            <div className="overflow-x-auto border border-line rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-paperDim border-b border-line text-inkSoft font-mono uppercase">
                  <tr>
                    <th className="p-2.5">Medicine</th>
                    <th className="p-2.5">Dosage</th>
                    <th className="p-2.5">Frequency</th>
                    <th className="p-2.5">Duration</th>
                    <th className="p-2.5">Instructions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {meds.map((m, idx) => (
                    <tr key={idx} className="hover:bg-paperDim/40">
                      <td className="p-2.5 font-semibold text-ink">{m.name}</td>
                      <td className="p-2.5 font-mono">{m.dosage}</td>
                      <td className="p-2.5 font-mono text-sage-700 font-semibold">{m.frequency}</td>
                      <td className="p-2.5">{m.duration}</td>
                      <td className="p-2.5 text-inkSoft">{m.instructions || "As directed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Clinical Advice / Notes */}
          {prescription.notes && (
            <div className="mb-6">
              <h4 className="font-display font-semibold text-xs text-inkSoft uppercase tracking-wider mb-1">
                Advice & Diet / Precautions:
              </h4>
              <p className="text-xs text-ink bg-paperDim/50 p-2.5 rounded-lg whitespace-pre-wrap leading-relaxed">
                {prescription.notes}
              </p>
            </div>
          )}

          {/* Doctor Signature / Stamp footer */}
          <div className="pt-6 border-t border-line flex justify-between items-end text-xs text-inkSoft">
            <div>
              <p>Generated electronically via MediBook</p>
              <p className="font-mono text-[10px]">Valid digital medical record</p>
            </div>
            <div className="text-right">
              <div className="w-32 border-b border-ink/40 mb-1"></div>
              <p className="font-semibold text-ink">{prescription.doctor_name}</p>
              <p className="text-[10px]">Authorized Medical Practitioner</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
