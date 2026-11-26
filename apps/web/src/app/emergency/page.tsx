'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import {
  PhoneCall,
  AlertTriangle,
  Ambulance,
  MapPin,
  Clock,
  ShieldAlert,
  Navigation,
  Activity,
  XCircle,
} from 'lucide-react';
import { fetchApi, getAuthToken } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { registerSocket } from '@/lib/socket-registry';
import { EmergencyMap } from '@/components/emergency-map';

interface EmergencyInfo {
  emergencyHotlines: { name: string; number: string; description: string }[];
  hospitals: {
    id: string;
    name: string;
    address: string;
    phone: string;
    emergencyPhone: string;
    latitude: number;
    longitude: number;
    distanceKm?: number;
    hasTraumaCenter: boolean;
  }[];
}

interface OnlineUnit {
  driverId: string;
  vehicleNumber: string;
  driverName: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
}

interface AmbulanceTrip {
  id: string;
  status: string;
  pickupLat: number | string;
  pickupLng: number | string;
  pickupAddress: string;
  etaSeconds: number | null;
  driver?: {
    id: string;
    vehicleNumber: string;
    lastLat?: number | string | null;
    lastLng?: number | string | null;
    user?: { name: string; phone?: string };
  } | null;
}

export default function EmergencyPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [pickupLat, setPickupLat] = useState(22.5512);
  const [pickupLng, setPickupLng] = useState(88.3524);
  const [pickupAddress, setPickupAddress] = useState(
    'Park Street Crossing, Kolkata',
  );
  const [activeTrip, setActiveTrip] = useState<AmbulanceTrip | null>(null);
  const [liveCoords, setLiveCoords] = useState<{
    lat: number;
    lng: number;
    distanceKm?: number;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'locating' | 'ready' | 'denied' | 'timeout'>('locating');

  const hasSession = Boolean(user);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      const timer = setTimeout(() => {
        setGpsStatus((current) => (current === 'locating' ? 'timeout' : current));
      }, 10000);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          if (pos.coords.latitude && pos.coords.longitude) {
            setPickupLat(Number(pos.coords.latitude.toFixed(5)));
            setPickupLng(Number(pos.coords.longitude.toFixed(5)));
            setGpsStatus('ready');
          }
        },
        (err) => {
          clearTimeout(timer);
          if (err.code === 1) {
            setGpsStatus('denied');
          } else {
            setGpsStatus('timeout');
          }
        },
        { timeout: 10000, enableHighAccuracy: true },
      );

      return () => clearTimeout(timer);
    } else {
      setGpsStatus('denied');
    }
  }, []);

  const emergencyInfoQuery = useQuery<EmergencyInfo>({
    queryKey: ['emergency-info', pickupLat, pickupLng],
    queryFn: () =>
      fetchApi<EmergencyInfo>(
        `/ambulance/emergency?lat=${pickupLat}&lng=${pickupLng}`,
      ),
  });

  const onlineDriversQuery = useQuery<OnlineUnit[]>({
    queryKey: ['online-ambulance-drivers', pickupLat, pickupLng],
    enabled: hasSession,
    queryFn: () =>
      fetchApi<OnlineUnit[]>(
        `/ambulance/drivers/online?lat=${pickupLat}&lng=${pickupLng}`,
      ),
    refetchInterval: 5000,
  });

  const activeTripQuery = useQuery<AmbulanceTrip | null>({
    queryKey: ['active-ambulance-request'],
    enabled: hasSession,
    queryFn: () => fetchApi<AmbulanceTrip | null>('/ambulance/requests/active'),
  });

  useEffect(() => {
    if (activeTripQuery.data) {
      setActiveTrip(activeTripQuery.data);
      if (
        activeTripQuery.data.driver?.lastLat &&
        activeTripQuery.data.driver?.lastLng
      ) {
        setLiveCoords({
          lat: Number(activeTripQuery.data.driver.lastLat),
          lng: Number(activeTripQuery.data.driver.lastLng),
        });
      }
    }
  }, [activeTripQuery.data]);

  // Real Socket.IO /ambulance subscription
  useEffect(() => {
    const token = getAuthToken();
    if (!token || !activeTrip?.id) return;

    const socketOrigin =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const socket: Socket = io(`${socketOrigin}/ambulance`, {
      auth: (cb) => {
        cb({ token: getAuthToken() || '' });
      },
      transports: ['websocket', 'polling'],
    });
    const unregisterSocket = registerSocket(socket);

    socket.on('connect', () => {
      socket.emit('join_tracking', { requestId: activeTrip.id });
    });

    socket.on('ambulance_status', (payload: any) => {
      if (payload.requestId !== activeTrip.id) return;
      setActiveTrip((prev) =>
        prev
          ? {
              ...prev,
              status: payload.status ?? prev.status,
              etaSeconds:
                payload.etaSeconds !== undefined
                  ? payload.etaSeconds
                  : prev.etaSeconds,
              driver: payload.driver !== undefined ? payload.driver : prev.driver,
            }
          : prev,
      );
      if (payload.driver?.lastLat && payload.driver?.lastLng) {
        setLiveCoords({
          lat: Number(payload.driver.lastLat),
          lng: Number(payload.driver.lastLng),
        });
      }
    });

    socket.on('ambulance_location', (payload: any) => {
      if (payload.requestId !== activeTrip.id) return;
      setLiveCoords({
        lat: Number(payload.latitude),
        lng: Number(payload.longitude),
        distanceKm: payload.distanceKm,
      });
      if (payload.etaSeconds !== undefined) {
        setActiveTrip((prev) =>
          prev ? { ...prev, etaSeconds: payload.etaSeconds } : prev,
        );
      }
    });

    return () => {
      unregisterSocket();
      socket.disconnect();
    };
  }, [activeTrip?.id]);

  const dispatchMutation = useMutation({
    mutationFn: () =>
      fetchApi<{ request: AmbulanceTrip; matchedDriver: any }>(
        '/ambulance/requests',
        {
          method: 'POST',
          body: JSON.stringify({
            pickupLat,
            pickupLng,
            pickupAddress,
          }),
        },
      ),
    onSuccess: (res) => {
      setActionError(null);
      setActiveTrip(res.request);
      if (res.request.driver?.lastLat && res.request.driver?.lastLng) {
        setLiveCoords({
          lat: Number(res.request.driver.lastLat),
          lng: Number(res.request.driver.lastLng),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['active-ambulance-request'] });
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const simulateTripMutation = useMutation({
    mutationFn: (requestId: string) =>
      fetchApi<{ started: boolean }>(
        `/ambulance/dev/requests/${requestId}/simulate-trip`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) =>
      fetchApi<AmbulanceTrip>(`/ambulance/requests/${requestId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (updated) => {
      setActiveTrip(updated);
      setLiveCoords(null);
      queryClient.invalidateQueries({ queryKey: ['active-ambulance-request'] });
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const hotlines = emergencyInfoQuery.data?.emergencyHotlines ?? [];
  const hospitals = emergencyInfoQuery.data?.hospitals ?? [];
  const onlineUnits = onlineDriversQuery.data ?? [];

  const isTerminal =
    activeTrip &&
    ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(activeTrip.status);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Emergency Banner */}
        <div className="bg-red-600 text-white rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl animate-pulse">
              <ShieldAlert className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                24/7 Emergency SOS & Ambulance Dispatch
              </h1>
              <p className="text-red-100 text-sm">
                Instant Redis GEO nearest-unit dispatch, 20-second timeout
                cascade & real-time Leaflet GPS tracking.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <a
              href="tel:112"
              className="px-5 py-2.5 bg-white text-red-600 font-bold rounded-xl shadow flex items-center gap-2 hover:bg-red-50 transition-colors"
            >
              <PhoneCall className="w-4 h-4" /> Call 112
            </a>
            <a
              href="tel:108"
              className="px-5 py-2.5 bg-red-800 text-white font-bold rounded-xl shadow flex items-center gap-2 hover:bg-red-900 transition-colors"
            >
              <PhoneCall className="w-4 h-4" /> Call 108
            </a>
          </div>
        </div>

        {/* Live Leaflet Map + Dispatch Card */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Navigation className="w-5 h-5 text-red-600" /> Live Dispatch
                Map (Kolkata)
              </h2>
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                {onlineUnits.length} Online Unit{onlineUnits.length === 1 ? '' : 's'}
              </span>
            </div>
            <EmergencyMap
              pickup={{
                lat: pickupLat,
                lng: pickupLng,
                label: pickupAddress,
              }}
              ambulance={
                liveCoords && activeTrip && !isTerminal
                  ? {
                      lat: liveCoords.lat,
                      lng: liveCoords.lng,
                      vehicleNumber: activeTrip.driver?.vehicleNumber,
                    }
                  : null
              }
              hospitals={hospitals}
              onlineUnits={onlineUnits}
            />
          </div>

          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4">
            {hasSession && activeTripQuery.isLoading ? (
              <div className="py-12 text-center text-xs text-slate-500 animate-pulse">
                Checking active ambulance dispatch...
              </div>
            ) : !activeTrip || isTerminal ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                    <Ambulance className="w-6 h-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Dispatch Nearest Ambulance
                    </h2>
                    <p className="text-xs text-slate-500">
                      Atomic single-winner claim & 20s cascade reassignment.
                    </p>
                  </div>
                </div>

                {activeTrip && isTerminal && (
                  <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300">
                    Previous request ended with status:{' '}
                    <strong>{activeTrip.status}</strong>
                  </div>
                )}

                {(gpsStatus === 'denied' || gpsStatus === 'timeout') && (
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>GPS Permission Unavailable — Manual Address Enabled</span>
                    </div>
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                      Enter your address or tap a landmark below. For life-threatening emergencies, dial 112 / 108 immediately.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Pickup Address
                  </label>
                  <input
                    type="text"
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-slate-400">Presets:</span>
                    {[
                      { label: 'Park Street', lat: 22.5512, lng: 88.3524 },
                      { label: 'Howrah Station', lat: 22.5857, lng: 88.3426 },
                      { label: 'Salt Lake Sec V', lat: 22.5735, lng: 88.4331 },
                      { label: 'SSKM Hospital', lat: 22.5398, lng: 88.3442 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setPickupAddress(preset.label + ', Kolkata');
                          setPickupLat(preset.lat);
                          setPickupLng(preset.lng);
                        }}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-teal-50 dark:hover:bg-teal-950/40 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div>
                    <label className="block font-medium mb-1">Latitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={pickupLat}
                      onChange={(e) => setPickupLat(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Longitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={pickupLng}
                      onChange={(e) => setPickupLng(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                {actionError && (
                  <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2.5 rounded-lg">
                    {actionError}
                  </p>
                )}

                {hasSession ? (
                  <button
                    onClick={() => dispatchMutation.mutate()}
                    disabled={dispatchMutation.isPending}
                    className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-all text-base disabled:opacity-60"
                  >
                    {dispatchMutation.isPending
                      ? 'Searching Nearest Unit...'
                      : 'Request Emergency Ambulance'}
                  </button>
                ) : (
                  <Link
                    href="/auth/login"
                    className="block w-full text-center py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-all text-sm"
                  >
                    Sign In to Dispatch Ambulance
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span
                    data-testid="ambulance-status-badge"
                    className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 flex items-center gap-1.5"
                  >
                    <Activity className="w-3.5 h-3.5" /> {activeTrip.status}
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    #{activeTrip.id.slice(0, 8)}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {activeTrip.driver?.user?.name ||
                      'Searching / Awaiting Unit Assignment'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Vehicle:{' '}
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {activeTrip.driver?.vehicleNumber || 'Pending offer...'}
                    </span>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-emerald-600" /> Estimated
                      Arrival
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {activeTrip.etaSeconds !== null
                        ? activeTrip.etaSeconds === 0
                          ? 'Arrived'
                          : `${Math.max(1, Math.ceil(activeTrip.etaSeconds / 60))} mins`
                        : 'Calculating...'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-red-500" /> Driver GPS
                    </span>
                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                      {liveCoords
                        ? `${liveCoords.lat.toFixed(4)}, ${liveCoords.lng.toFixed(4)}`
                        : 'Awaiting telemetry'}
                    </span>
                  </div>
                </div>

                {actionError && (
                  <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2.5 rounded-lg">
                    {actionError}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => simulateTripMutation.mutate(activeTrip.id)}
                    disabled={
                      simulateTripMutation.isPending ||
                      activeTrip.status === 'ARRIVED'
                    }
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm disabled:opacity-50 transition-colors"
                  >
                    {simulateTripMutation.isPending
                      ? 'Starting Live Driver Simulator...'
                      : 'Simulate Live Driver Telemetry (Dev)'}
                  </button>
                  <button
                    onClick={() => cancelMutation.mutate(activeTrip.id)}
                    disabled={cancelMutation.isPending}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl text-sm flex items-center justify-center gap-1.5"
                  >
                    <XCircle className="w-4 h-4" /> Cancel Request
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Emergency Hotlines */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {hotlines.map((h) => (
            <div
              key={h.number}
              className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-sm"
            >
              <div>
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">
                  {h.name}
                </p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {h.number}
                </p>
                <p className="text-xs text-slate-500">{h.description}</p>
              </div>
              <a
                href={`tel:${h.number}`}
                aria-label={`Call ${h.name} at ${h.number}`}
                className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-xl hover:bg-red-100 transition-colors"
              >
                <PhoneCall aria-hidden="true" className="w-5 h-5" />
              </a>
            </div>
          ))}
        </div>

        {/* Nearest Hospitals */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-red-600" /> Nearest Trauma Centres &
              Hospitals
            </h2>
            <span className="text-xs text-slate-500">
              {emergencyInfoQuery.isLoading ? 'Loading...' : 'Sorted by proximity'}
            </span>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {hospitals.map((hosp) => (
              <div
                key={hosp.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white">
                      {hosp.name}
                    </h3>
                    {hosp.hasTraumaCenter && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded uppercase">
                        Trauma Unit
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {hosp.address}
                  </p>
                  <p className="text-xs text-slate-500">
                    {hosp.distanceKm !== undefined ? `${hosp.distanceKm} km away • ` : ''}
                    Direct: {hosp.phone}
                  </p>
                </div>
                <a
                  href={`tel:${hosp.emergencyPhone}`}
                  className="px-4 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-sm font-medium rounded-xl flex items-center gap-1.5 self-start sm:self-center"
                >
                  <PhoneCall className="w-3.5 h-3.5" /> Call ({hosp.emergencyPhone})
                </a>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex gap-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p>
            <strong>Medical Disclaimer:</strong> In life-threatening
            emergencies, call local emergency services (112 / 108) directly.
          </p>
        </div>
      </div>
    </div>
  );
}
