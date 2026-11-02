# Phase 6 Plan: Emergency Ambulance Dispatch System

## Objectives
1. Emergency SOS API & Hospital Locator:
   - Public emergency endpoint: one-tap coordinates capture, emergency call routing to 112 and 108.
   - Nearby hospitals lookup with Haversine distance, emergency contacts, trauma center readiness, and OSM coordinates.
   - Guaranteed to work even if zero drivers are online.
2. Driver Telemetry & Redis GEO:
   - `DRIVER` role profile (`AmbulanceDriverProfile`).
   - Online/offline toggle.
   - Driver location streaming into Redis GEO key `ambulance:drivers:geo` (`GEOADD`).
   - Heartbeat TTL: driver sets key `ambulance:driver:heartbeat:<id>` with 30s TTL. If heartbeat expires, driver is automatically omitted from geo queries.
3. Dispatch State Machine & 20s Cascading Offer:
   - States: `REQUESTED -> OFFERED -> ACCEPTED -> EN_ROUTE -> ARRIVED -> COMPLETED | CANCELLED | EXPIRED`.
   - Dispatch algorithm:
     - Finds online, non-stale drivers within 15 km using `GEORADIUS` / `GEOSEARCH`.
     - Calculates Haversine distance and dynamic ETA (based on 30 km/h urban speed).
     - Offers to nearest driver with a 20-second offer lock/countdown.
     - If driver rejects or 20s expires, automatically cascades to next nearest driver.
4. Concurrency Protection & Atomic Claim:
   - Atomic conditional update: `UPDATE ambulance_requests SET status = 'ACCEPTED', driver_id = $1 WHERE id = $2 AND status = 'OFFERED'` with affected rows check.
   - Guarantee: exactly one driver wins the claim race; all concurrent attempts receive `ConflictException`.
5. WebSocket Live Tracking & Isolation:
   - Room `ambulance:<requestId>`.
   - Socket namespace: `/ambulance`.
   - Isolated telemetry: only authorized patient and assigned driver can subscribe to `ambulance:<requestId>`.
6. Kolkata Driver Simulation Script:
   - `scripts/simulate-drivers.ts`: spawns 20 realistic emergency ambulances moving around Kolkata landmarks (Park Street, Salt Lake, Howrah, Esplanade, New Town).
7. Tests to Deliver:
   - `concurrent-accept.spec.ts`: 10 parallel driver accept requests -> exactly 1 winner, 9 conflicts.
   - `timeout-reassignment.spec.ts`: 20s offer expiry cascades to the second-nearest driver.
   - `stale-driver-eviction.spec.ts`: drivers with missing heartbeat are evicted from dispatch offers.
   - `ambulance-socket-isolation.spec.ts`: telemetry emitted in room A never leaks to room B.
