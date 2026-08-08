import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PulseDivider from "../components/PulseDivider";
import { SPECIALTIES } from "../lib/specialties";

export default function Landing() {
  const [symptom, setSymptom] = useState("");
  const navigate = useNavigate();

  function handleSymptomSearch(e) {
    e.preventDefault();
    if (!symptom.trim()) return;
    navigate(`/doctors?symptom=${encodeURIComponent(symptom.trim())}`);
  }

  return (
    <div>
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-sage-600">
          Appointment No. 001 — Your visit starts here
        </p>
        <h1 className="mt-4 font-display text-5xl font-medium leading-tight text-ink sm:text-6xl">
          Describe how you feel.
          <br />
          We'll find who can help.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-inkSoft">
          No jargon, no guesswork. Tell us your symptom in plain words and MediBook
          matches you to the right specialist nearby — verified clinics only.
        </p>

        <PulseDivider animate color="#2F6F4E" />

        <form
          onSubmit={handleSymptomSearch}
          className="mx-auto flex max-w-lg flex-col gap-3 sm:flex-row"
        >
          <input
            className="input-field"
            placeholder="e.g. chest pain, toothache, fever…"
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
          />
          <button type="submit" className="btn-primary whitespace-nowrap">
            Find a doctor
          </button>
        </form>

        <p className="mt-4 text-xs text-inkSoft/70">
          Prefer to browse instead?{" "}
          <button
            onClick={() => navigate("/doctors")}
            className="font-semibold text-sage-600 underline underline-offset-2"
          >
            See all verified doctors
          </button>
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-inkSoft">
          Or search by specialty
        </h2>
        <div className="flex flex-wrap justify-center gap-2">
          {SPECIALTIES.map((s) => (
            <button
              key={s}
              onClick={() => navigate(`/doctors?specialty=${encodeURIComponent(s)}`)}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm text-ink transition-colors hover:border-sage-500 hover:text-sage-600"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-white py-16">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 sm:grid-cols-3">
          {[
            { n: "Verified clinics", d: "Every doctor is manually reviewed by our team before they can accept bookings." },
            { n: "No double-booking", d: "Slots lock the moment you book — what you see is always what's actually free." },
            { n: "Symptom-first search", d: "Tell us what's wrong, not which -ologist you need. We work that part out." },
          ].map((item) => (
            <div key={item.n}>
              <h3 className="font-display text-lg font-semibold text-ink">{item.n}</h3>
              <p className="mt-2 text-sm text-inkSoft">{item.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
