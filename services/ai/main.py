"""
MediBook FastAPI AI Service
- Emergency Triage: Sentence-embedding LogisticRegression + multi-lingual red-flag safety net
- RAG: PostgreSQL pgvector (HNSW cosine) + GIN tsvector RRF hybrid search with score-threshold abstention
- LLM Abstraction: OllamaLLMProvider (default in dev/prod) + DeterministicMockLLMProvider (CI / fallback)
- Booking Agent: Calls real NestJS scheduling API using the authenticated user's own JWT token
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, Header
from pydantic import BaseModel, Field

from booking_agent import RealBookingAgent
from embeddings import get_embedding_provider
from llm_provider import get_llm_provider
from rag import get_rag_store
from triage_model import check_emergency_rules, get_triage_model, infer_specialty


app = FastAPI(title="MediBook AI Service", version="2.0.0")


class TriageRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    user_id: Optional[str] = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    user_id: Optional[str] = None
    conversation_history: List[Dict[str, str]] = Field(default_factory=list)


class CopilotNoteRequest(BaseModel):
    appointment_id: str
    doctor_id: str
    patient_name: str
    messages: List[Dict[str, str]] = Field(default_factory=list)


def check_emergency(query: str):
    """Compatibility helper exporting combined emergency detection."""
    res = get_triage_model().predict(query)
    return res["is_emergency"], res.get("matched_rule")


@app.get("/health")
def health():
    rag = get_rag_store()
    llm = get_llm_provider()
    emb = get_embedding_provider()
    return {
        "status": "ok",
        "rag_backend": rag.backend,
        "indexed_chunks": len(rag.chunks),
        "embedding_dim": emb.dimension,
        "llm_provider": llm.provider_name,
    }


@app.get("/evals/triage")
def triage_eval_summary():
    model = get_triage_model()
    return model.eval_report


@app.post("/triage")
def triage(req: TriageRequest):
    pred = get_triage_model().predict(req.query)
    if pred["is_emergency"]:
        return {
            "is_emergency": True,
            "emergency_card": {
                "emergency_title": "IMMEDIATE MEDICAL EMERGENCY DETECTED",
                "instructions": (
                    "Your symptoms indicate a potentially life-threatening emergency. "
                    "Do NOT wait for a tele-consultation. Call emergency services or request an ambulance immediately."
                ),
                "call_number": "112",
                "dispatch_recommended": True,
            },
            "urgency_level": "CRITICAL",
            "recommended_specialty": None,
            "confidence": pred["confidence"],
            "safety_rule_triggered": pred["safety_rule_triggered"],
        }

    return {
        "is_emergency": False,
        "emergency_card": None,
        "urgency_level": pred["urgency_level"],
        "recommended_specialty": pred["recommended_specialty"],
        "confidence": pred["confidence"],
        "safety_rule_triggered": False,
    }


@app.post("/chat")
def chat(
    req: ChatRequest,
    authorization: Optional[str] = Header(default=None),
):
    # 1. Safety-first ML + Rule Emergency Triage (always intercepts first)
    triage_res = get_triage_model().predict(req.message)
    if triage_res["is_emergency"]:
        return {
            "is_emergency": True,
            "emergency_card": {
                "emergency_title": "IMMEDIATE MEDICAL EMERGENCY DETECTED",
                "instructions": (
                    "Urgent red-flag symptoms detected. Bypass online queues: dial 112 / 108 or dispatch "
                    "an ambulance immediately."
                ),
                "call_number": "112",
                "dispatch_recommended": True,
            },
            "reply": "Emergency red-flag symptoms detected. Please call 112 or dispatch an ambulance immediately.",
            "citations": [
                {
                    "source": "emergency_triage.md",
                    "title": "WHO ETAT Red-Flag Protocol",
                    "snippet": "Do NOT delay care with digital appointments; call 112 or 108 immediately.",
                }
            ],
            "abstained": False,
            "recommended_specialty": None,
            "tool_call": None,
            "disclaimer": "MediBook AI does not replace emergency clinical care. Dial 112 / 108 immediately.",
        }

    # 2. Booking Agent using authenticated user's own JWT token
    specialty = triage_res.get("recommended_specialty") or infer_specialty(req.message)
    agent = RealBookingAgent()
    agent_out = agent.run(req.message, authorization, specialty)
    if agent_out.get("handled"):
        return {
            "is_emergency": False,
            "emergency_card": None,
            "reply": agent_out["reply"],
            "citations": [
                {
                    "source": "platform_policies.md",
                    "title": "MediBook Scheduling & Slot Holds",
                    "snippet": "10-minute Redis slot hold precedes payment checkout.",
                }
            ],
            "abstained": False,
            "recommended_specialty": specialty,
            "tool_call": agent_out.get("tool_call"),
            "disclaimer": "MediBook AI booking assistance requires your confirmation before payment.",
        }

    # 3. Hybrid pgvector + tsvector RAG Search with Abstention below threshold
    rag = get_rag_store()
    chunks, abstained, max_score = rag.search(req.message, top_k=3)

    if abstained or not chunks:
        return {
            "is_emergency": False,
            "emergency_card": None,
            "reply": (
                "I am abstaining from answering because this query is outside MediBook's verified clinical "
                "guidance and platform documentation. Please consult a verified specialist or ask about symptoms, "
                "telemedicine policies, or bookings."
            ),
            "citations": [],
            "abstained": True,
            "retrieval_score": round(max_score, 4),
            "search_backend": rag.backend,
            "recommended_specialty": None,
            "tool_call": None,
            "disclaimer": "Abstained due to low retrieval confidence (< score threshold) to prevent hallucination.",
        }

    llm = get_llm_provider()
    reply = llm.generate_rag_answer(req.message, chunks, recommended_specialty=specialty)
    citations = [
        {
            "source": c["source"],
            "title": c["title"],
            "snippet": " ".join(c["content"].split())[:220],
            "score": c["hybrid_score"],
        }
        for c in chunks
    ]

    return {
        "is_emergency": False,
        "emergency_card": None,
        "reply": reply,
        "citations": citations,
        "abstained": False,
        "retrieval_score": round(max_score, 4),
        "search_backend": rag.backend,
        "recommended_specialty": specialty,
        "tool_call": None,
        "disclaimer": (
            "MediBook AI provides non-diagnostic informational guidance grounded in verified protocols. "
            "Always confirm medical decisions with a licensed doctor."
        ),
    }


@app.post("/copilot/draft-note")
def copilot_draft_note(req: CopilotNoteRequest):
    llm = get_llm_provider()
    soap_note = llm.generate_soap_note(req.patient_name, req.messages)
    return {
        "appointment_id": req.appointment_id,
        "doctor_id": req.doctor_id,
        "soap_note": soap_note,
    }
