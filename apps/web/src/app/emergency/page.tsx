'use client';

import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  ShieldAlert,
  PhoneCall,
  MapPin,
  Ambulance,
  Clock,
  Navigation,
  Building,
} from 'lucide-react';

interface Hospital {
  name: string;
  distanceKm: number;
  phone: string;
  hasTraumaICU: boolean;
  address: string;
}

const kolkataHospitals: Hospital[] = [
  {
    name: 'SSKM Hospital (IPGMER) - Level 1 Trauma Care',
    distanceKm: 2.1,
    phone: '033-2223-1589',
    hasTraumaICU: true,
    address: '244 AJC Bose Road, Bhowanipore, Kolkata 700020',
  },
  {
    name: 'Calcutta Medical College & Hospital',
    distanceKm: 3.4,
    phone: '033-2255-1600',
    hasTraumaICU: true,
    address: '88 College Street, College Square, Kolkata 700073',
  },
  {
    name: 'Apollo Gleneagles Multispeciality Hospital',
    distanceKm: 4.8,
    phone: '033-2320-3040',
    hasTraumaICU: true,
    address: '58 Canal Circular Rd, Kankurgachi, Kolkata 700054',
  },
  {
    name: 'Fortis Hospital Anandapur - 24/7 Cardiac Emergency',
    distanceKm: 6.2,
    phone: '033-6628-4444',
    hasTraumaICU: true,
    address: '730 Anandapur, E.M. Bypass Road, Kolkata 700107',
  },
];

type DispatchStatus = 'IDLE' | 'REQUESTED' | 'OFFERED' | 'ACCEPTED' | 'EN_ROUTE' | 'ARRIVED';

export default function EmergencyPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<DispatchStatus>('IDLE');
  const [etaMinutes, setEtaMinutes] = useState<number>(8);
  const [driverInfo, setDriverInfo] = useState<{
    name: string;
    vehicleNo: string;
    phone: string;
  } | null>(null);

  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: 22.5726,
    lng: 88.3639, // Central Kolkata
  });

  const handleCaptureLocation = () => {
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          alert(`Location captured: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
        },
        () => {
          alert('GPS permission not granted. Defaulting to Central Kolkata epicenter.');
        }
      );
    }
  };

  const handleRequestDispatch = () => {
    setStatus('REQUESTED');
    // Simulate offer countdown and driver accept
    setTimeout(() => {
      setStatus('OFFERED');
      setTimeout(() => {
        setStatus('ACCEPTED');
        setDriverInfo({
          name: 'Rajesh Karmakar',
          vehicleNo: 'WB-02-AX-8910 (Advanced Cardiac Life Support)',
          phone: '+91 98301 22910',
        });
        setEtaMinutes(7);
        setTimeout(() => {
          setStatus('EN_ROUTE');
          setEtaMinutes(4);
        }, 3000);
      }, 2000);
    }, 1500);
  };

  const handleCancelDispatch = () => {
    setStatus('IDLE');
    setDriverInfo(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner Alert */}
      <div className="p-6 rounded-3xl bg-rose-600 text-white shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0">
            <ShieldAlert className="w-10 h-10 text-white animate-pulse" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-800 text-rose-100 text-xs font-bold uppercase mb-1">
              Priority 1 Emergency Response
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold">{t.emergency.title}</h1>
            <p className="text-xs sm:text-sm text-rose-100 mt-1 max-w-xl">{t.emergency.subtitle}</p>
          </div>
        </div>

        {/* Immediate Call Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto shrink-0">
          <a
            href="tel:112"
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-rose-700 font-extrabold text-sm shadow-md hover:bg-rose-50 transition-colors"
          >
            <PhoneCall className="w-4 h-4" />
            <span>Call 112 (National)</span>
          </a>
          <a
            href="tel:108"
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-rose-800 hover:bg-rose-900 text-white font-extrabold text-sm shadow-md transition-colors"
          >
            <PhoneCall className="w-4 h-4" />
            <span>Call 108 (EMS)</span>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Live Dispatch Panel */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Ambulance className="w-5 h-5 text-rose-600" /> Live Ambulance Dispatch
              </h2>
              <button
                onClick={handleCaptureLocation}
                className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
              >
                <Navigation className="w-3.5 h-3.5" /> Recalibrate GPS
              </button>
            </div>

            {/* GPS Location Banner */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 text-rose-600" />
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">
                    Location: Kolkata EMS Cluster
                  </span>
                  <span className="text-slate-400 font-mono">
                    {coords.lat.toFixed(4)}° N, {coords.lng.toFixed(4)}° E
                  </span>
                </div>
              </div>
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded">
                GPS Locked
              </span>
            </div>

            {/* Status Timeline */}
            {status !== 'IDLE' ? (
              <div className="space-y-6">
                <div className="p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-300 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
                      Status: {status}
                    </span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1">
                      <Clock className="w-4 h-4 text-rose-600" /> ETA: {etaMinutes} Mins
                    </span>
                  </div>

                  <p className="text-xs text-rose-900 dark:text-rose-200 leading-relaxed">
                    {status === 'REQUESTED' && t.emergency.statusRequested}
                    {status === 'OFFERED' && t.emergency.statusOffered}
                    {status === 'ACCEPTED' && t.emergency.statusAccepted}
                    {status === 'EN_ROUTE' && t.emergency.statusEnRoute}
                    {status === 'ARRIVED' && t.emergency.statusArrived}
                  </p>

                  {driverInfo && (
                    <div className="pt-3 border-t border-rose-200/80 dark:border-rose-900/80 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500 block">Driver:</span>
                        <span className="font-bold text-slate-800 dark:text-slate-100">{driverInfo.name}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Vehicle:</span>
                        <span className="font-bold text-slate-800 dark:text-slate-100">{driverInfo.vehicleNo}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Leaflet/OSM Simulation Frame */}
                <div className="h-64 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 relative overflow-hidden flex items-center justify-center">
                  <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:16px_16px] opacity-40 dark:opacity-20" />
                  <div className="relative text-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center mx-auto shadow-lg animate-bounce">
                      <Ambulance className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Ambulance En Route via E.M. Bypass
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Telemetry streaming to Redis GEO at 1.0 Hz (Haversine Distance: 2.8 km)
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleCancelDispatch}
                  className="w-full py-2.5 px-4 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                >
                  {t.emergency.cancel}
                </button>
              </div>
            ) : (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                  <Ambulance className="w-8 h-8" />
                </div>
                <div className="max-w-md mx-auto">
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    Need Emergency Ambulance in Kolkata?
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Dispatches the nearest available Advanced Cardiac Life Support (ACLS) ambulance from our 20-vehicle network.
                  </p>
                </div>
                <button
                  onClick={handleRequestDispatch}
                  className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm shadow-xl shadow-rose-600/30 transition-all transform hover:-translate-y-0.5"
                >
                  {t.emergency.requestAmbulance}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Nearest Designated Trauma Centers */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Building className="w-4 h-4 text-teal-600" />
              {t.emergency.nearbyHospitals}
            </h3>

            <div className="space-y-3">
              {kolkataHospitals.map((hosp) => (
                <div
                  key={hosp.name}
                  className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-white leading-snug">{hosp.name}</span>
                    <span className="text-[11px] font-bold text-rose-600 shrink-0">{hosp.distanceKm} km</span>
                  </div>
                  <p className="text-[11px] text-slate-500">{hosp.address}</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-semibold px-2 py-0.5 rounded">
                      24/7 Trauma ICU
                    </span>
                    <a
                      href={`tel:${hosp.phone}`}
                      className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
                    >
                      <PhoneCall className="w-3 h-3" /> {hosp.phone}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
