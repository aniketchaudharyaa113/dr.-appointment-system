# MediBook Frontend

React + Vite + Tailwind, wired to the MediBook backend.

## Setup

```bash
npm install
cp .env.example .env    # points to your backend, defaults to http://localhost:5000
npm run dev
```

Make sure the backend is running first (`npm run dev` in the backend folder) — this frontend calls it directly, there's no mock data.

## Design system

- **Colors:** deep forest-navy ink (`#16302B`) on a cool paper background (`#F4F6F4`), sage-emerald (`#2F6F4E`) as the primary action color, warm clay (`#C7622D`) for secondary/error accents. All defined as Tailwind tokens in `tailwind.config.js` — never hardcode a hex value in a component, use `text-ink`, `bg-sage-500`, etc.
- **Type:** Fraunces (serif, headings only) + Inter (body/UI) + IBM Plex Mono (times, prices, IDs, stats — anything that's *data* reads in mono so it's visually distinct from prose).
- **Signature element:** `PulseDivider` — a thin ECG-line SVG used as a section divider on the homepage. Doctor cards use a "ticket-stub" torn-edge top border (`.ticket-edge` in `index.css`) to reinforce the idea of booking a slot as getting a numbered ticket.

## How the pieces fit together

- `src/lib/api.js` — every backend call goes through here. One function per endpoint, so no component ever writes a raw `fetch()`.
- `src/context/AuthContext.jsx` — holds the logged-in user + JWT in React state and `localStorage`. `useAuth()` gives any component `{ user, token, login, logout }`.
- `src/components/ProtectedRoute.jsx` — wraps role-gated pages (`/my-appointments`, `/doctor/dashboard`, `/admin`) and redirects to `/login` or `/` if the user doesn't have access.
- `src/lib/socket.js` — one shared Socket.io connection. `DoctorProfile.jsx` listens for `slot-booked`/`slot-freed` events so a slot someone else just took disappears from your screen live, without a refresh.
- **Accurate slot grid on first load:** `DoctorProfile.jsx` calls `GET /doctors/:id/booked-slots` on mount and pre-fills the taken-slot set with it, so already-booked slots show as unavailable immediately — not just after a live socket event or a failed booking attempt. Combined with the socket listener, this keeps the grid correct both on load and while the page stays open.

## Next steps / things to build on top

- Show a Leaflet map on the symptom-search results page (the `leaflet`/`react-leaflet` packages are already installed but not wired into a map view yet)
- Add form validation feedback matching the backend's zod error messages more precisely
