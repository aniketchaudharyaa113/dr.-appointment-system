import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 10 },
    { duration: '15s', target: 25 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://nginx/api';
const PATIENT_EMAIL = __ENV.PATIENT_EMAIL || 'patient@medibook.test';
const PATIENT_PASSWORD = __ENV.PATIENT_PASSWORD || 'Password123!';

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: PATIENT_EMAIL, password: PATIENT_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(loginRes, {
    'setup login succeeded': (r) => r.status === 200 || r.status === 201,
  });
  const token = loginRes.json('accessToken');

  const docsRes = http.get(`${BASE_URL}/doctors?specialty=Cardiology`);
  const docs = docsRes.json('items') || docsRes.json();
  const doctorId = Array.isArray(docs) && docs.length > 0 ? docs[0].id : null;

  return { token, doctorId };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  // 1. Directory read under load
  const doctorsRes = http.get(`${BASE_URL}/doctors?specialty=Cardiology`);
  check(doctorsRes, {
    'doctors directory ok or 429 rate-limited': (r) =>
      r.status === 200 || r.status === 429,
  });

  // 2. Live slot lookup
  if (data.doctorId) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const slotsRes = http.get(
      `${BASE_URL}/doctors/${data.doctorId}/slots?date=${tomorrow}`,
    );
    check(slotsRes, {
      'slots lookup ok or 429': (r) => r.status === 200 || r.status === 429,
    });

    // 3. Contended hold attempt across VUs (only 1 winner per slot; 409 Conflict expected for losers)
    const holdRes = http.post(
      `${BASE_URL}/appointments/hold`,
      JSON.stringify({
        doctorId: data.doctorId,
        slotTime: `${tomorrow}T10:00:00+05:30`,
      }),
      { headers },
    );
    check(holdRes, {
      'hold atomic 201 or 409 conflict or 429': (r) =>
        r.status === 201 || r.status === 409 || r.status === 429,
    });
  }

  sleep(0.2);
}
