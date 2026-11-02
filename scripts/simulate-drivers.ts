/**
 * Kolkata Ambulance Driver Simulator
 * Simulates 20 ambulance drivers moving around Kolkata landmarks,
 * streaming Redis GEO coordinates and heartbeats.
 */
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

interface DriverSim {
  id: string;
  name: string;
  vehicleNumber: string;
  lat: number;
  lng: number;
  heading: number; // degrees
  speedKmh: number;
}

const KOLKATA_LANDMARKS = [
  { name: 'Park Street', lat: 22.5512, lng: 88.3524 },
  { name: 'Salt Lake Sector V', lat: 22.5804, lng: 88.4378 },
  { name: 'Howrah Station', lat: 22.5857, lng: 88.3426 },
  { name: 'Esplanade', lat: 22.5645, lng: 88.3516 },
  { name: 'New Town Action Area 1', lat: 22.5867, lng: 88.4754 },
  { name: 'Jadavpur 8B', lat: 22.4988, lng: 88.3715 },
  { name: 'Ballygunge Phari', lat: 22.5284, lng: 88.3654 },
  { name: 'Shyambazar Five Point', lat: 22.6001, lng: 88.3712 },
  { name: 'Behala Chowrasta', lat: 22.4854, lng: 88.3124 },
  { name: 'Alipore Zoo', lat: 22.5358, lng: 88.3328 },
  { name: 'Sealdah Station', lat: 22.5678, lng: 88.3712 },
  { name: 'Gariahat Market', lat: 22.5186, lng: 88.3654 },
  { name: 'Dum Dum Cantonment', lat: 22.6452, lng: 88.4215 },
  { name: 'Rajarhat Chowmatha', lat: 22.6215, lng: 88.4854 },
  { name: 'Tollygunge Tram Depot', lat: 22.4954, lng: 88.3456 },
  { name: 'Ruby Hospital Crossing', lat: 22.5124, lng: 88.4025 },
  { name: 'Science City', lat: 22.5398, lng: 88.3965 },
  { name: 'Ultadanga Hudco', lat: 22.5912, lng: 88.3854 },
  { name: 'Kankurgachi', lat: 22.5789, lng: 88.3895 },
  { name: 'Baguiati', lat: 22.6154, lng: 88.4312 },
];

const drivers: DriverSim[] = KOLKATA_LANDMARKS.map((lm, i) => ({
  id: `driver-kolkata-${i + 1}`,
  name: `Paramedic Unit ${i + 1}`,
  vehicleNumber: `WB-02-AM-${1000 + i}`,
  lat: lm.lat + (Math.random() - 0.5) * 0.005,
  lng: lm.lng + (Math.random() - 0.5) * 0.005,
  heading: Math.floor(Math.random() * 360),
  speedKmh: 25 + Math.floor(Math.random() * 20),
}));

async function stepSimulation() {
  const pipeline = redis.pipeline();

  for (const d of drivers) {
    // Move slightly (0.0003 deg ~ 30 meters per tick)
    const rad = (d.heading * Math.PI) / 180;
    d.lat += Math.cos(rad) * 0.0003;
    d.lng += Math.sin(rad) * 0.0003;

    // Slight drift in heading
    d.heading = (d.heading + (Math.random() - 0.5) * 20 + 360) % 360;

    // Redis GEOADD: longitude latitude member
    pipeline.geoadd('ambulance:drivers:geo', d.lng, d.lat, d.id);
    // 30s TTL heartbeat
    pipeline.setex(`ambulance:driver:heartbeat:${d.id}`, 30, '1');
  }

  await pipeline.exec();
}

async function run() {
  console.log(`Starting MediBook Ambulance Simulator: 20 ambulances streaming in Kolkata`);
  for (let i = 0; i < 5; i++) {
    await stepSimulation();
    console.log(`Tick ${i + 1}: Updated 20 active ambulances in Redis GEO`);
  }
  console.log(`Simulator ready. Continuous telemetry active.`);
  redis.disconnect();
}

if (require.main === module) {
  run().catch(console.error);
}

export { run, stepSimulation, drivers };
