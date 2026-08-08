// The canonical list of specialties MediBook recognizes. This must stay in
// sync with the specialty values used in db/seed.ts's symptom_specialty_map
// and with the SPECIALTIES array in the frontend (src/lib/specialties.js).
//
// Why this exists: specialty used to be a free-text field, which meant a
// doctor typing "Dental" instead of "Dentist" silently broke symptom search
// (which matches by exact string) with no error anywhere. Constraining it to
// this fixed list at the point of entry removes that whole bug class instead
// of trying to fuzzy-match around it later.
export const SPECIALTIES = [
  "General Physician",
  "Cardiologist",
  "Dermatologist",
  "Dentist",
  "Orthopedic",
  "Gynecologist",
  "Pediatrician",
  "Neurologist",
  "ENT Specialist",
  "Ophthalmologist",
  "Psychiatrist",
  "Gastroenterologist",
] as const;

export type Specialty = (typeof SPECIALTIES)[number];
