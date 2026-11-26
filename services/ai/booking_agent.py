"""
Real Booking Agent for MediBook AI.
Executes doctor directory lookups, slot availability queries, and slot holds
by calling the live NestJS API (`API_INTERNAL_URL`) with the authenticated user's own JWT token.
Never fabricates doctor names or bypasses human payment confirmation.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
import httpx

IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def _tomorrow_ist() -> str:
    return (datetime.now(IST) + timedelta(days=1)).strftime("%Y-%m-%d")


def detect_booking_intent(text: str) -> Optional[str]:
    lower = text.lower()
    if any(k in lower for k in ["checkout", "pay for my appointment", "complete payment", "make payment"]):
        return "create_checkout"
    if any(k in lower for k in ["cancel appointment", "cancel my booking"]):
        return "cancel_appointment"
    if any(k in lower for k in ["hold slot", "reserve slot", "book slot", "book appointment", "schedule appointment", "book a "]):
        return "book_or_hold"
    if any(k in lower for k in ["find doctor", "find a ", "available doctors", "available slots", "which doctors", "show doctors"]):
        return "search_doctors"
    return None


class RealBookingAgent:
    def __init__(self, api_base_url: Optional[str] = None):
        self.api_base_url = (
            api_base_url
            or os.getenv("API_INTERNAL_URL")
            or os.getenv("NEXT_PUBLIC_API_URL")
            or "http://127.0.0.1:4000/api"
        ).rstrip("/")

    def _headers(self, user_jwt: Optional[str]) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if user_jwt:
            token = user_jwt if user_jwt.lower().startswith("bearer ") else f"Bearer {user_jwt}"
            h["Authorization"] = token
        return h

    def run(
        self,
        message: str,
        user_jwt: Optional[str],
        inferred_specialty: Optional[str],
    ) -> Dict:
        intent = detect_booking_intent(message)
        if not intent:
            return {"handled": False}

        if intent == "create_checkout":
            return {
                "handled": True,
                "reply": (
                    "Payment requires your explicit confirmation. Review the order summary on your "
                    "MediBook checkout page and click Pay / Simulate Payment to finalize."
                ),
                "tool_call": {
                    "tool": "create_checkout",
                    "arguments": {"note": "Requires user confirmation on /checkout"},
                    "requires_confirmation": True,
                },
            }

        if intent == "cancel_appointment":
            return {
                "handled": True,
                "reply": "To cancel an appointment with automatic refund calculation, open My Appointments or provide the appointment ID.",
                "tool_call": {
                    "tool": "cancel_appointment",
                    "arguments": {},
                    "requires_confirmation": True,
                },
            }

        if not user_jwt:
            return {
                "handled": True,
                "reply": "Please sign in first so I can search live slots and place a booking hold under your account.",
                "tool_call": {
                    "tool": "require_auth",
                    "arguments": {"loginPath": "/auth/login"},
                    "requires_confirmation": True,
                },
            }

        # Call real NestJS API `/doctors` using the user's own JWT token
        specialty_param = inferred_specialty if inferred_specialty and inferred_specialty != "General Medicine" else None
        if "cardiolog" in message.lower():
            specialty_param = "Cardiology"
        elif "dermatolog" in message.lower():
            specialty_param = "Dermatology"
        elif "dent" in message.lower():
            specialty_param = "Dentistry"
        elif "pediatr" in message.lower():
            specialty_param = "Pediatrics"

        headers = self._headers(user_jwt)
        try:
            params = {"specialty": specialty_param} if specialty_param else {}
            doc_resp = httpx.get(
                f"{self.api_base_url}/doctors",
                params=params,
                headers=headers,
                timeout=4.0,
            )
            if not doc_resp.is_success:
                return {
                    "handled": True,
                    "reply": f"Unable to query live doctors (API returned {doc_resp.status_code}). Please use the Doctors page directly.",
                    "tool_call": None,
                }
            payload = doc_resp.json()
            doctors: List[Dict] = (
                payload.get("data", payload.get("items", payload))
                if isinstance(payload, dict)
                else payload
            )

            if not doctors and specialty_param:
                # Retry unfiltered directory so user gets verified options
                all_resp = httpx.get(f"{self.api_base_url}/doctors", headers=headers, timeout=4.0)
                if all_resp.is_success:
                    ap = all_resp.json()
                    doctors = (
                        ap.get("data", ap.get("items", ap))
                        if isinstance(ap, dict)
                        else ap
                    )

            if not doctors:
                return {
                    "handled": True,
                    "reply": "No verified doctors are currently available matching your criteria.",
                    "tool_call": None,
                }

            # Prefer doctor mentioned by name if present
            selected_doc = doctors[0]
            msg_lower = message.lower()
            for d in doctors:
                doc_name = (d.get("user", {}).get("name") or d.get("name") or "").lower()
                if doc_name and any(part in msg_lower for part in doc_name.split() if len(part) > 3 and part != "dr."):
                    selected_doc = d
                    break

            target_date = _tomorrow_ist() if "tomorrow" in msg_lower else _today_ist()
            slots_resp = httpx.get(
                f"{self.api_base_url}/doctors/{selected_doc['id']}/slots",
                params={"date": target_date},
                headers=headers,
                timeout=4.0,
            )
            slots: List[Dict] = []
            if slots_resp.is_success:
                sp = slots_resp.json()
                raw_slots = sp.get("slots", sp) if isinstance(sp, dict) else sp
                slots = [
                    s for s in raw_slots
                    if isinstance(s, dict) and (s.get("isAvailable") is True or s.get("status") == "AVAILABLE")
                ]

            doc_name_display = selected_doc.get("user", {}).get("name") or selected_doc.get("name") or "Doctor"
            fee_inr = round(int(selected_doc.get("consultationFeePaise", 80000)) / 100)

            # Explicit slot time requested -> acquire real Redis hold via POST /appointments/hold
            time_match = re.search(r"\b(\d{1,2}:\d{2})\b", message)
            if time_match and intent == "book_or_hold" and slots:
                req_hhmm = time_match.group(1).zfill(5)
                matching_slot = next(
                    (
                        s for s in slots
                        if str(s.get("displayTime", s.get("slotTime", ""))).startswith(req_hhmm)
                    ),
                    slots[0],
                )
                slot_iso = (
                    matching_slot.get("slotIso")
                    or (
                        matching_slot.get("slotTime")
                        if "T" in str(matching_slot.get("slotTime", ""))
                        else f"{target_date}T{matching_slot.get('displayTime') or matching_slot.get('slotTime')}+05:30"
                    )
                )
                hold_resp = httpx.post(
                    f"{self.api_base_url}/appointments/hold",
                    headers=headers,
                    json={"doctorId": selected_doc["id"], "slotTime": slot_iso},
                    timeout=4.0,
                )
                if hold_resp.is_success:
                    hold_data = hold_resp.json()
                    return {
                        "handled": True,
                        "reply": (
                            f"Reserved a 10-minute slot hold with **{doc_name_display}** ({selected_doc.get('specialty')}) "
                            f"for `{slot_iso}` (Fee: ₹{fee_inr}). Please confirm on the doctor page to proceed to checkout."
                        ),
                        "tool_call": {
                            "tool": "hold_slot",
                            "arguments": {
                                "doctorId": selected_doc["id"],
                                "doctorName": doc_name_display,
                                "slotTime": slot_iso,
                                "holdToken": hold_data.get("holdToken"),
                                "expiresInSeconds": hold_data.get("expiresInSeconds", 600),
                            },
                            "requires_confirmation": True,
                        },
                    }

            top_times = ", ".join(str(s.get("slotTime", ""))[:5] for s in slots[:4]) or "check doctor schedule"
            return {
                "handled": True,
                "reply": (
                    f"Found **{doc_name_display}** ({selected_doc.get('specialty')}, ₹{fee_inr}) on MediBook. "
                    f"Available IST slots for {target_date}: {top_times}. "
                    f"Confirm to open their booking calendar and place a 10-minute hold."
                ),
                "tool_call": {
                    "tool": "search_doctors",
                    "arguments": {
                        "doctorId": selected_doc["id"],
                        "doctorName": doc_name_display,
                        "specialty": selected_doc.get("specialty"),
                        "date": target_date,
                        "availableSlots": [s.get("slotTime") for s in slots[:5]],
                    },
                    "requires_confirmation": True,
                },
            }
        except Exception as err:
            return {
                "handled": True,
                "reply": f"Live scheduling lookup unavailable ({type(err).__name__}). Please browse `/doctors` directly.",
                "tool_call": None,
            }
