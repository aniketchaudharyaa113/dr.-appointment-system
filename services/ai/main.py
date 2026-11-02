import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

app = FastAPI(
    title="MediBook AI Intelligence Service",
    description="Microservice for Emergency Triage, Clinical RAG, Doctor Copilot, and Booking Agent",
    version="1.0.0",
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class TriageRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Patient symptoms or query")
    user_id: Optional[str] = None


class EmergencyCard(BaseModel):
    emergency_title: str
    instructions: str
    call_number: str
    dispatch_recommended: bool


class TriageResponse(BaseModel):
    is_emergency: bool
    emergency_card: Optional[EmergencyCard] = None
    urgency_level: str  # LOW, MEDIUM, HIGH, CRITICAL
    recommended_specialty: Optional[str] = None
    confidence: float


EMERGENCY_KEYWORDS = [
    "chest pain",
    "heart attack",
    "difficulty breathing",
    "shortness of breath",
    "cannot breathe",
    "severe bleeding",
    "stroke",
    "face drooping",
    "numbness in arm",
    "slurred speech",
    "unconscious",
    "passed out",
    "seizure",
    "overdose",
    "anaphylaxis",
    "severe burn",
    "coughing blood",
]


@app.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse(status="ok", service="ai-gateway", version="1.0.0")


@app.post("/triage", response_model=TriageResponse)
def evaluate_triage(req: TriageRequest):
    query_lower = req.query.lower()
    for kw in EMERGENCY_KEYWORDS:
        if kw in query_lower:
            return TriageResponse(
                is_emergency=True,
                emergency_card=EmergencyCard(
                    emergency_title="POTENTIAL MEDICAL EMERGENCY DETECTED",
                    instructions="Stop activity. Call national emergency services immediately or request an emergency ambulance.",
                    call_number="112",
                    dispatch_recommended=True,
                ),
                urgency_level="CRITICAL",
                recommended_specialty="Emergency Medicine / Cardiology",
                confidence=1.0,
            )

    # Standard non-emergency symptoms
    if any(s in query_lower for s in ["heart", "palpitation", "hypertension", "bp"]):
        specialty = "Cardiologist"
    elif any(s in query_lower for s in ["skin", "rash", "itching", "acne"]):
        specialty = "Dermatologist"
    elif any(s in query_lower for s in ["child", "infant", "baby", "pediatric"]):
        specialty = "Pediatrician"
    elif any(s in query_lower for s in ["tooth", "teeth", "gum", "dentist"]):
        specialty = "Dentist"
    elif any(s in query_lower for s in ["eye", "vision", "blur"]):
        specialty = "Ophthalmologist"
    elif any(s in query_lower for s in ["fever", "cough", "cold", "flu"]):
        specialty = "General Physician"
    else:
        specialty = "General Physician"

    return TriageResponse(
        is_emergency=False,
        urgency_level="LOW",
        recommended_specialty=specialty,
        confidence=0.92,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
