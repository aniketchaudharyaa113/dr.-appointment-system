'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
}

interface HospitalMarker {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  emergencyPhone: string;
  distanceKm?: number;
}

interface OnlineUnit {
  driverId: string;
  vehicleNumber: string;
  latitude: number | null;
  longitude: number | null;
}

interface EmergencyMapProps {
  pickup: MapPoint;
  ambulance: { lat: number; lng: number; vehicleNumber?: string } | null;
  hospitals: HospitalMarker[];
  onlineUnits: OnlineUnit[];
}

export function EmergencyMap({
  pickup,
  ambulance,
  hospitals,
  onlineUnits,
}: EmergencyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const layersRef = useRef<{
    pickup?: any;
    ambulance?: any;
    route?: any;
    hospitals: any[];
    units: any[];
  }>({ hospitals: [], units: [] });

  useEffect(() => {
    let active = true;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;
      const L = (await import('leaflet')).default;
      if (!active || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: [pickup.lat, pickup.lng],
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      // Render initial markers immediately once map is mounted
      syncLayers(L, map);
    }

    function syncLayers(L: any, map: any) {
      const pickupIcon = L.divIcon({
        className: 'medibook-pickup-marker',
        html: `<div style="width:18px;height:18px;border-radius:9999px;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 6px rgba(220,38,38,0.28)"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      if (layersRef.current.pickup) {
        layersRef.current.pickup.setLatLng([pickup.lat, pickup.lng]);
      } else {
        layersRef.current.pickup = L.marker([pickup.lat, pickup.lng], {
          icon: pickupIcon,
        })
          .bindPopup(pickup.label || 'Emergency Pickup')
          .addTo(map);
      }

      // Clear old hospitals
      for (const h of layersRef.current.hospitals) h.remove();
      layersRef.current.hospitals = hospitals.map((h) => {
        const icon = L.divIcon({
          className: 'medibook-hospital-marker',
          html: `<div style="width:22px;height:22px;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">H</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        return L.marker([h.latitude, h.longitude], { icon })
          .bindPopup(
            `<strong>${h.name}</strong><br/>Emergency: ${h.emergencyPhone}${
              h.distanceKm !== undefined ? `<br/>${h.distanceKm} km away` : ''
            }`,
          )
          .addTo(map);
      });

      // Clear idle units
      for (const u of layersRef.current.units) u.remove();
      layersRef.current.units = onlineUnits
        .filter((u) => u.latitude !== null && u.longitude !== null)
        .map((u) => {
          const icon = L.divIcon({
            className: 'medibook-unit-marker',
            html: `<div style="padding:2px 6px;border-radius:9999px;background:#0f766e;color:#fff;font-size:10px;font-weight:700;border:1.5px solid #fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.25)">AMB</div>`,
            iconSize: [34, 18],
            iconAnchor: [17, 9],
          });
          return L.marker([u.latitude!, u.longitude!], { icon })
            .bindPopup(`Unit ${u.vehicleNumber}`)
            .addTo(map);
        });

      // Assigned moving ambulance
      if (ambulance) {
        const ambIcon = L.divIcon({
          className: 'medibook-active-amb',
          html: `<div style="padding:3px 8px;border-radius:9999px;background:#059669;color:#fff;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 0 0 6px rgba(5,150,105,0.3);white-space:nowrap">🚑 ${
            ambulance.vehicleNumber || 'DISPATCHED'
          }</div>`,
          iconSize: [88, 24],
          iconAnchor: [44, 12],
        });

        if (layersRef.current.ambulance) {
          layersRef.current.ambulance.setLatLng([ambulance.lat, ambulance.lng]);
        } else {
          layersRef.current.ambulance = L.marker(
            [ambulance.lat, ambulance.lng],
            { icon: ambIcon },
          ).addTo(map);
        }

        if (layersRef.current.route) {
          layersRef.current.route.setLatLngs([
            [ambulance.lat, ambulance.lng],
            [pickup.lat, pickup.lng],
          ]);
        } else {
          layersRef.current.route = L.polyline(
            [
              [ambulance.lat, ambulance.lng],
              [pickup.lat, pickup.lng],
            ],
            { color: '#059669', weight: 3, dashArray: '6, 8' },
          ).addTo(map);
        }
      } else {
        if (layersRef.current.ambulance) {
          layersRef.current.ambulance.remove();
          layersRef.current.ambulance = undefined;
        }
        if (layersRef.current.route) {
          layersRef.current.route.remove();
          layersRef.current.route = undefined;
        }
      }
    }

    initMap();
    if (mapRef.current && leafletRef.current) {
      syncLayers(leafletRef.current, mapRef.current);
    }

    return () => {
      active = false;
    };
  }, [pickup, ambulance, hospitals, onlineUnits]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="emergency-leaflet-map"
      className="w-full h-80 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden z-0"
    />
  );
}
