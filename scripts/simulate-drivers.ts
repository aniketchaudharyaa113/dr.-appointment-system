/**
 * Kolkata Ambulance Driver Simulator
 * Connects real seeded DRIVER accounts against the running MediBook API (`/api/ambulance/*`),
 * streaming live GPS telemetry around Kolkata and automatically accepting + driving offered trips.
 */

const API_BASE = process.env.API_URL || 'http://localhost/api';

interface DriverConfig {
  email: string;
  password: string;
  lat: number;
  lng: number;
  heading: number;
  token?: string;
}

const DRIVERS: DriverConfig[] = [
  {
    email: 'driver@medibook.test',
    password: 'Password123!',
    lat: 22.5512, // Park Street
    lng: 88.3524,
    heading: 45,
  },
  {
    email: 'driver2@medibook.test',
    password: 'Password123!',
    lat: 22.5804, // Salt Lake Sector V
    lng: 88.4378,
    heading: 210,
  },
];

async function loginDriver(driver: DriverConfig): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: driver.email, password: driver.password }),
  });
  if (!res.ok) {
    throw new Error(`Driver login failed for ${driver.email}: ${res.status}`);
  }
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

async function tickDriver(driver: DriverConfig) {
  if (!driver.token) {
    driver.token = await loginDriver(driver);
  }

  // Check active offers/trips
  const offersRes = await fetch(`${API_BASE}/ambulance/driver/offers`, {
    headers: { Authorization: `Bearer ${driver.token}` },
  });
  if (offersRes.ok) {
    const offers = (await offersRes.json()) as Array<{
      id: string;
      status: string;
      pickupLat: number;
      pickupLng: number;
    }>;

    const active = offers[0];
    if (active) {
      if (active.status === 'OFFERED') {
        await fetch(`${API_BASE}/ambulance/requests/${active.id}/accept`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${driver.token}` },
        });
        await fetch(`${API_BASE}/ambulance/requests/${active.id}/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${driver.token}`,
          },
          body: JSON.stringify({ status: 'EN_ROUTE' }),
        });
      }

      // Steer toward patient pickup
      const dLat = Number(active.pickupLat) - driver.lat;
      const dLng = Number(active.pickupLng) - driver.lng;
      const dist = Math.hypot(dLat, dLng);
      if (dist < 0.001) {
        driver.lat = Number(active.pickupLat);
        driver.lng = Number(active.pickupLng);
        await fetch(`${API_BASE}/ambulance/requests/${active.id}/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${driver.token}`,
          },
          body: JSON.stringify({ status: 'ARRIVED' }),
        });
      } else {
        const step = Math.min(0.0015, dist);
        driver.lat += (dLat / dist) * step;
        driver.lng += (dLng / dist) * step;
      }
    } else {
      // Cruise along Kolkata streets
      const rad = (driver.heading * Math.PI) / 180;
      driver.lat += Math.cos(rad) * 0.0003;
      driver.lng += Math.sin(rad) * 0.0003;
      driver.heading = (driver.heading + (Math.random() - 0.5) * 20 + 360) % 360;
    }
  }

  await fetch(`${API_BASE}/ambulance/driver/telemetry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driver.token}`,
    },
    body: JSON.stringify({
      latitude: driver.lat,
      longitude: driver.lng,
      isOnline: true,
    }),
  });
}

async function run() {
  const maxTicks = Number(process.env.SIMULATOR_TICKS || 5);
  console.log(
    `🚑 MediBook Ambulance Simulator (${API_BASE}) streaming ${DRIVERS.length} units`,
  );
  for (let i = 0; i < maxTicks; i++) {
    await Promise.all(DRIVERS.map((d) => tickDriver(d)));
    console.log(`Tick ${i + 1}/${maxTicks}: telemetry synced to Redis GEO`);
    if (i + 1 < maxTicks) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
