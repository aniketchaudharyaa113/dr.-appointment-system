const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// Every request goes through here, so token attachment and error
// shaping only has to be written once.
async function request(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  const currentToken = token || localStorage.getItem("medibook_token");
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

  let res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  // Attempt automatic token refresh on 401 if not already an auth route
  if (res.status === 401 && !path.startsWith("/auth/")) {
    try {
      const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.token) {
          localStorage.setItem("medibook_token", refreshData.token);
          headers.Authorization = `Bearer ${refreshData.token}`;
          // Retry original request with new access token
          res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            credentials: "include",
            body: body ? JSON.stringify(body) : undefined,
          });
        }
      }
    } catch {}
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  signup: (payload) => request("/auth/signup", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  refreshToken: () => request("/auth/refresh", { method: "POST" }),
  logout: () => request("/auth/logout", { method: "POST" }),

  getDoctors: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/doctors${qs ? `?${qs}` : ""}`);
  },
  getDoctorById: (id) => request(`/doctors/${id}`),
  getBookedSlots: (id) => request(`/doctors/${id}/booked-slots`),
  getMyDoctorProfile: (token) => request("/doctors/me", { token }),
  updateMyDoctorProfile: (payload, token) =>
    request("/doctors/me", { method: "PATCH", body: payload, token }),
  setAvailability: (slots, token, dryRun = false) =>
    request(`/doctors/me/availability${dryRun ? "?dryRun=true" : ""}`, { method: "PATCH", body: { slots }, token }),
  addDoctorLeave: (leaveDate, reason, token, dryRun = false) =>
    request(`/doctors/me/leaves${dryRun ? "?dryRun=true" : ""}`, { method: "POST", body: { leaveDate, reason }, token }),
  removeDoctorLeave: (date, token) =>
    request(`/doctors/me/leaves/${date}`, { method: "DELETE", token }),
  getMyEarnings: (token) => request("/doctors/me/earnings", { token }),

  symptomSearch: (q, lat, lng) => {
    const params = new URLSearchParams({ q });
    if (lat && lng) {
      params.set("lat", lat);
      params.set("lng", lng);
    }
    return request(`/search/symptom?${params.toString()}`);
  },

  createAppointment: (payload, token) =>
    request("/appointments", { method: "POST", body: payload, token }),
  getMyAppointments: (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/appointments/mine${qs ? `?${qs}` : ""}`, { token });
  },
  cancelAppointment: (id, token, reason) =>
    request(`/appointments/${id}/cancel`, { method: "PATCH", body: { reason }, token }),
  completeAppointment: (id, notes, token) =>
    request(`/appointments/${id}/complete`, { method: "PATCH", body: { notes }, token }),
  rescheduleAppointment: (id, newSlotTime, token) =>
    request(`/appointments/${id}/reschedule`, { method: "PATCH", body: { newSlotTime }, token }),

  // Prescriptions
  createPrescription: (payload, token) =>
    request("/prescriptions", { method: "POST", body: payload, token }),
  getMyPrescriptions: (token) => request("/prescriptions/mine", { token }),
  getPrescriptionByAppointment: (appointmentId, token) =>
    request(`/prescriptions/appointment/${appointmentId}`, { token }),

  // Notifications
  getMyNotifications: (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/notifications${qs ? `?${qs}` : ""}`, { token });
  },
  markNotificationAsRead: (id, token) =>
    request(`/notifications/${id}/read`, { method: "PATCH", token }),
  markAllNotificationsAsRead: (token) =>
    request("/notifications/read-all", { method: "PATCH", token }),

  createReview: (payload, token) =>
    request("/reviews", { method: "POST", body: payload, token }),

  // Admin
  getPendingDoctors: (token) => request("/admin/doctors/pending", { token }),
  verifyDoctor: (id, approve, token) =>
    request(`/admin/doctors/${id}/verify`, { method: "PATCH", body: { approve }, token }),
  getAllAppointments: (params = {}, token) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/appointments${qs ? `?${qs}` : ""}`, { token });
  },
  getStats: (token) => request("/admin/stats", { token }),
  getAuditLogs: (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/audit-logs${qs ? `?${qs}` : ""}`, { token });
  },
};

