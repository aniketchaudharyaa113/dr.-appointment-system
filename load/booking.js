import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 50 },  // Ramp-up to 50 VUs
    { duration: "1m", target: 200 },   // Stress peak at 200 VUs
    { duration: "30s", target: 0 },    // Ramp-down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost";

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function () {
  // 1. Browse doctors with caching & pg_trgm symptom search
  const searchRes = http.get(`${BASE_URL}/search/symptom?q=chest+pain`);
  check(searchRes, {
    "search status is 200": (r) => r.status === 200,
  });

  const listRes = http.get(`${BASE_URL}/doctors?limit=10`);
  check(listRes, {
    "doctor list status is 200": (r) => r.status === 200,
  });

  sleep(1);

  // Authenticate demo patient for booking flow
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: "patient@medibook.com",
      password: "patient123",
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (loginRes.status !== 200) {
    return;
  }

  const token = loginRes.json("token");
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // Inspect first doctor profile
  let doctors = [];
  try {
    const body = listRes.json();
    doctors = body.data || body;
  } catch {}

  const doctor = doctors && doctors.length > 0 ? doctors[0] : null;
  if (!doctor) return;

  const docRes = http.get(`${BASE_URL}/doctors/${doctor.id}`);
  check(docRes, {
    "doctor profile status is 200": (r) => r.status === 200,
  });

  // Pick target slot (upcoming date)
  const slotTime = "2027-05-15T11:00:00";

  // 2. Slot Hold (Redis 5-minute atomic lock)
  const holdRes = http.post(
    `${BASE_URL}/appointments/hold`,
    JSON.stringify({
      doctorId: doctor.id,
      slotTime,
    }),
    { headers: authHeaders }
  );

  const holdOk = holdRes.status === 200;
  const holdToken = holdOk ? holdRes.json("holdToken") : undefined;

  sleep(1);

  // 3. Book Appointment with Idempotency Key header and Hold Token
  const idempotencyKey = generateUUID();
  const bookRes = http.post(
    `${BASE_URL}/appointments`,
    JSON.stringify({
      doctorId: doctor.id,
      slotTime,
      holdToken,
    }),
    {
      headers: Object.assign({}, authHeaders, {
        "Idempotency-Key": idempotencyKey,
      }),
    }
  );

  check(bookRes, {
    "booking responded with 201 or 409": (r) => r.status === 201 || r.status === 409,
  });

  // Replay idempotency test: same key should return same response instantly from Redis
  if (bookRes.status === 201) {
    const replayRes = http.post(
      `${BASE_URL}/appointments`,
      JSON.stringify({
        doctorId: doctor.id,
        slotTime,
        holdToken,
      }),
      {
        headers: Object.assign({}, authHeaders, {
          "Idempotency-Key": idempotencyKey,
        }),
      }
    );
    check(replayRes, {
      "idempotency replay returned same 201 status": (r) => r.status === 201,
    });
  }

  // 4. View My Appointments
  const myApptsRes = http.get(`${BASE_URL}/appointments/mine?limit=5`, {
    headers: authHeaders,
  });
  check(myApptsRes, {
    "my appointments status is 200": (r) => r.status === 200,
  });

  sleep(1);
}
