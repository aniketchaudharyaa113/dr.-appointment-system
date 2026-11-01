import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { useAuth } from "../context/AuthContext";
import StarRating from "../components/StarRating";
import { slotToKey } from "../lib/format";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Builds the next 7 calendar dates starting today, each tagged with its weekday index.
function upcomingDates() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
}

// Turns "09:00:00" + a duration into an array of "HH:MM" start times
// up to (but not including) the end time.
function generateSlotsForDay(startTime, endTime, durationMinutes) {
  const slots = [];
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let cursor = sh * 60 + sm;
  const end = eh * 60 + em;

  while (cursor + durationMinutes <= end) {
    const h = String(Math.floor(cursor / 60)).padStart(2, "0");
    const m = String(cursor % 60).padStart(2, "0");
    slots.push(`${h}:${m}`);
    cursor += durationMinutes;
  }
  return slots;
}

// Local-only check for "has this slot's time already passed today?" - both
// sides here are real local Date objects compared within the same browser,
// so this is safe even though the app avoids Date objects for anything that
// crosses the network (see isoFor below).
function isPastSlot(date, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const slotDate = new Date(date);
  slotDate.setHours(h, m, 0, 0);
  return slotDate.getTime() <= Date.now();
}

export default function DoctorProfile() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [doctor, setDoctor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(null);
  const [takenSlots, setTakenSlots] = useState(new Set()); // "YYYY-MM-DDTHH:MM" strings
  const [heldSlots, setHeldSlots] = useState(new Set()); // slots held by other users
  const [myHold, setMyHold] = useState(null); // { slotTime, holdToken, secondsLeft, hhmm }
  const [booking, setBooking] = useState(false);
  const [bookingMsg, setBookingMsg] = useState("");

  useEffect(() => {
    api.getDoctorById(id).then(setDoctor).catch((e) => setError(e.message)).finally(() => setLoading(false));

    // Pre-fill already-booked slots
    api.getBookedSlots(id)
      .then((slots) => {
        setTakenSlots(new Set(slots.map(slotToKey)));
      })
      .catch(() => {});

    // Pre-fill currently held slots
    api.getHeldSlots(id, token)
      .then((holds) => {
        const otherHolds = holds.filter((h) => !h.heldByMe).map((h) => slotToKey(h.slotTime));
        setHeldSlots(new Set(otherHolds));
      })
      .catch(() => {});
  }, [id, token]);

  // Live updates: join doctor's room to receive scoped slot events
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    socket.emit("watch-doctor", id);

    function onBooked(payload) {
      if (payload.doctorId !== id) return;
      setTakenSlots((prev) => new Set(prev).add(slotToKey(payload.slotTime)));
      setHeldSlots((prev) => {
        const next = new Set(prev);
        next.delete(slotToKey(payload.slotTime));
        return next;
      });
    }
    function onFreed(payload) {
      if (payload.doctorId !== id) return;
      setTakenSlots((prev) => {
        const next = new Set(prev);
        next.delete(slotToKey(payload.slotTime));
        return next;
      });
    }
    function onHeld(payload) {
      if (payload.doctorId !== id) return;
      if (payload.heldBy !== user?.id) {
        setHeldSlots((prev) => new Set(prev).add(slotToKey(payload.slotTime)));
      }
    }
    function onHoldReleased(payload) {
      if (payload.doctorId !== id) return;
      setHeldSlots((prev) => {
        const next = new Set(prev);
        next.delete(slotToKey(payload.slotTime));
        return next;
      });
    }

    socket.on("slot-booked", onBooked);
    socket.on("slot-freed", onFreed);
    socket.on("slot-held", onHeld);
    socket.on("slot-hold-released", onHoldReleased);

    return () => {
      socket.emit("unwatch-doctor", id);
      socket.off("slot-booked", onBooked);
      socket.off("slot-freed", onFreed);
      socket.off("slot-held", onHeld);
      socket.off("slot-hold-released", onHoldReleased);
    };
  }, [id, user]);

  // 5-minute hold countdown timer
  useEffect(() => {
    if (!myHold) return;
    const interval = setInterval(() => {
      setMyHold((prev) => {
        if (!prev) return null;
        if (prev.secondsLeft <= 1) {
          clearInterval(interval);
          setBookingMsg("Your 5-minute hold on this slot has expired. Please select a slot again.");
          return null;
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [myHold]);

  const dates = useMemo(() => upcomingDates(), []);

  const isSelectedDateOnLeave = useMemo(() => {
    if (!doctor || !selectedDate || !doctor.leaves) return false;
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const d = String(selectedDate.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    return doctor.leaves.some((l) => String(l).slice(0, 10) === dateStr);
  }, [doctor, selectedDate]);

  const slotsForSelectedDate = useMemo(() => {
    if (!doctor || !selectedDate || isSelectedDateOnLeave) return [];
    const dayOfWeek = selectedDate.getDay();
    const avail = doctor.availability?.find((a) => a.day_of_week === dayOfWeek);
    if (!avail) return [];
    return generateSlotsForDay(avail.start_time, avail.end_time, avail.slot_duration_minutes || 15);
  }, [doctor, selectedDate, isSelectedDateOnLeave]);

  function isoFor(date, hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    return `${y}-${mo}-${d}T${hh}:${mm}:00`;
  }

  async function handleSlotClick(hhmm) {
    if (!user) return navigate("/login");
    if (user.role !== "PATIENT") {
      setBookingMsg("Only patient accounts can book appointments.");
      return;
    }
    const slotTime = isoFor(selectedDate, hhmm);
    setBooking(true);
    setBookingMsg("");

    try {
      if (myHold && myHold.slotTime !== slotTime) {
        api.releaseHold({ doctorId: id, slotTime: myHold.slotTime, holdToken: myHold.holdToken }, token).catch(() => {});
      }
      const res = await api.holdSlot({ doctorId: id, slotTime }, token);
      setMyHold({
        slotTime,
        holdToken: res.holdToken,
        secondsLeft: res.expiresIn || 300,
        hhmm,
      });
    } catch (err) {
      setBookingMsg(err.message);
    } finally {
      setBooking(false);
    }
  }

  async function handleConfirmBooking() {
    if (!myHold) return;
    setBooking(true);
    setBookingMsg("");
    try {
      const appt = await api.createAppointment(
        { doctorId: id, slotTime: myHold.slotTime, holdToken: myHold.holdToken },
        token
      );
      setTakenSlots((prev) => new Set(prev).add(myHold.slotTime));
      setBookingMsg(
        `Booked! Your reference: ${appt.booking_ref}. Address: ${appt.clinic_address || doctor.clinic_address || "see clinic details above"}.`
      );
      setMyHold(null);
    } catch (err) {
      setBookingMsg(err.message);
      if (err.message.toLowerCase().includes("booked")) {
        setTakenSlots((prev) => new Set(prev).add(myHold.slotTime));
      }
    } finally {
      setBooking(false);
    }
  }

  async function handleCancelHold() {
    if (!myHold) return;
    try {
      await api.releaseHold({ doctorId: id, slotTime: myHold.slotTime, holdToken: myHold.holdToken }, token);
    } catch {}
    setMyHold(null);
  }

  if (loading) return <p className="mx-auto max-w-4xl px-6 py-16 text-inkSoft">Loading…</p>;
  if (error) return <p className="mx-auto max-w-4xl px-6 py-16 text-clay-600">{error}</p>;
  if (!doctor) return null;

  const avgRating = doctor.reviews?.length
    ? doctor.reviews.reduce((sum, r) => sum + r.rating, 0) / doctor.reviews.length
    : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="card p-6 sm:p-8">
        <p className="font-mono text-xs uppercase tracking-wide text-sage-600">{doctor.specialty}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-ink">{doctor.name}</h1>
        <p className="mt-1 text-sm text-inkSoft">
          {doctor.qualifications || "Qualifications not listed"} · {doctor.experience_years || 0} yrs experience
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          {avgRating && (
            <span className="flex items-center gap-1.5">
              <StarRating value={avgRating} /> ({doctor.reviews.length})
            </span>
          )}
          <span className="font-mono text-ink">
            ₹{Number(doctor.consultation_fee || 0).toFixed(0)} / visit
          </span>
        </div>

        <p className="mt-3 text-sm text-inkSoft">{doctor.clinic_name} — {doctor.clinic_address}</p>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold text-ink">Pick a date</h2>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {dates.map((d) => {
            const active = selectedDate?.toDateString() === d.toDateString();
            return (
              <button
                key={d.toISOString()}
                onClick={() => setSelectedDate(d)}
                className={`flex min-w-[64px] flex-col items-center rounded-card border px-3 py-2 text-sm transition-colors ${
                  active ? "border-sage-500 bg-sage-50 text-sage-700" : "border-line bg-white text-inkSoft hover:border-sage-300"
                }`}
              >
                <span className="font-mono text-xs">{DAY_NAMES[d.getDay()]}</span>
                <span className="font-semibold">{d.getDate()}</span>
              </button>
            );
          })}
        </div>

        {selectedDate && (
          <div className="mt-5">
            {slotsForSelectedDate.length === 0 ? (
              <p className="text-sm text-inkSoft">
                {isSelectedDateOnLeave
                  ? "Doctor is on scheduled leave / unavailable on this date."
                  : "Doctor isn't available on this day."}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slotsForSelectedDate.map((hhmm) => {
                  const iso = isoFor(selectedDate, hhmm);
                  const isTaken = takenSlots.has(iso);
                  const isHeldByOther = heldSlots.has(iso);
                  const isHeldByMe = myHold?.slotTime === iso;
                  const isPast = isPastSlot(selectedDate, hhmm);
                  const unavailable = isTaken || isHeldByOther || isPast;

                  let style = "border-line bg-white text-ink hover:border-sage-500 hover:bg-sage-50";
                  if (isHeldByMe) {
                    style = "border-sage-600 bg-sage-100 text-sage-900 ring-2 ring-sage-500 font-bold";
                  } else if (isHeldByOther) {
                    style = "cursor-not-allowed border-amber-300 bg-amber-50 text-amber-800/80";
                  } else if (unavailable) {
                    style = "cursor-not-allowed border-line bg-paperDim text-inkSoft/40 line-through";
                  }

                  let title = undefined;
                  if (isPast) title = "This time has already passed today";
                  else if (isTaken) title = "Already booked";
                  else if (isHeldByOther) title = "Currently reserved by another patient";
                  else if (isHeldByMe) title = "Held by you";

                  return (
                    <button
                      key={hhmm}
                      disabled={(unavailable && !isHeldByMe) || booking}
                      title={title}
                      onClick={() => handleSlotClick(hhmm)}
                      className={`rounded-card border px-3 py-2 font-mono text-sm transition-colors ${style}`}
                    >
                      {hhmm}
                      {isHeldByOther && <span className="block text-[10px] font-sans font-medium uppercase tracking-tight text-amber-700">Held</span>}
                      {isHeldByMe && <span className="block text-[10px] font-sans font-medium uppercase tracking-tight text-sage-700">Reserved</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {myHold && (
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-card border border-sage-500 bg-sage-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Slot reserved for you: <span className="font-mono text-sage-800">{myHold.hhmm}</span>
                  </p>
                  <p className="text-xs text-inkSoft">
                    Hold expires in: <span className="font-mono font-bold text-amber-700">
                      {Math.floor(myHold.secondsLeft / 60)}:{String(myHold.secondsLeft % 60).padStart(2, "0")}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmBooking}
                    disabled={booking}
                    className="rounded-button bg-sage-600 px-4 py-2 text-sm font-medium text-white hover:bg-sage-700 disabled:opacity-50"
                  >
                    {booking ? "Confirming..." : "Confirm Booking"}
                  </button>
                  <button
                    onClick={handleCancelHold}
                    disabled={booking}
                    className="rounded-button border border-line bg-white px-3 py-2 text-xs font-medium text-inkSoft hover:bg-paperDim"
                  >
                    Release
                  </button>
                </div>
              </div>
            )}

            {bookingMsg && (
              <p className={`mt-3 text-sm ${bookingMsg.startsWith("Booked") ? "text-sage-600" : "text-clay-600"}`}>
                {bookingMsg}
              </p>
            )}
          </div>
        )}
      </section>

      {doctor.reviews?.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold text-ink">What patients say</h2>
          <div className="mt-3 space-y-3">
            {doctor.reviews.map((r, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{r.patient_name}</span>
                  <StarRating value={r.rating} />
                </div>
                {r.comment && <p className="mt-1 text-sm text-inkSoft">{r.comment}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
