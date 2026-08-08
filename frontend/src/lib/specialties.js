// Must stay in sync with backend/src/constants.ts SPECIALTIES.
// Kept as a plain array (not imported cross-project) since frontend and
// backend are separate deployable apps - if you rename a specialty, update
// both files and the symptom_specialty_map seed data together.
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
];
