import os
import re
import glob
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

app = FastAPI(
    title="MediBook AI Intelligence Service",
    description="Microservice for Emergency Triage, Clinical RAG, Doctor Copilot, and Booking Agent",
    version="1.0.0",
)

# -------------------------------------------------------------------------
# Models
# -------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class EmergencyCard(BaseModel):
    emergency_title: str
    instructions: str
    call_number: str
    dispatch_recommended: bool


class TriageRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Patient symptoms or query")
    user_id: Optional[str] = None


class TriageResponse(BaseModel):
    is_emergency: bool
    emergency_card: Optional[EmergencyCard] = None
    urgency_level: str  # LOW, MEDIUM, HIGH, CRITICAL
    recommended_specialty: Optional[str] = None
    confidence: float


class Citation(BaseModel):
    source: str
    title: str
    snippet: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    user_id: Optional[str] = None
    role: str = "PATIENT"
    conversation_history: List[Dict[str, str]] = []


class ToolCall(BaseModel):
    tool: str
    arguments: Dict[str, Any]
    requires_confirmation: bool


class ChatResponse(BaseModel):
    is_emergency: bool
    emergency_card: Optional[EmergencyCard] = None
    reply: str
    citations: List[Citation] = []
    recommended_specialty: Optional[str] = None
    tool_call: Optional[ToolCall] = None
    disclaimer: str = "MediBook AI provides informational guidance only and cannot replace professional clinical diagnosis. Consult a qualified physician."


class CopilotRequest(BaseModel):
    appointment_id: str
    doctor_id: str
    patient_name: str
    messages: List[Dict[str, str]] = []


class SoapNote(BaseModel):
    subjective: str
    objective: str
    assessment: str
    plan: str
    watermark: str = "DRAFT - Requires Attending Doctor Review & Approval"


class CopilotResponse(BaseModel):
    appointment_id: str
    soap_note: SoapNote


# -------------------------------------------------------------------------
# Emergency Detection Lexicon & Multi-Condition Classifier
# -------------------------------------------------------------------------

CRITICAL_STANDALONE_TERMS = {
    "unconscious", "passed out", "seizure", "convulsing", "anaphylaxis",
    "stroke", "overdose", "cyanosis", "heart attack", "cardiac arrest",
    "slurred speech", "face drooping"
}

def check_emergency(query: str) -> Optional[EmergencyCard]:
    q = query.lower()

    # 1. Direct standalone critical indicators
    for term in CRITICAL_STANDALONE_TERMS:
        if term in q:
            return EmergencyCard(
                emergency_title="POTENTIAL CRITICAL EMERGENCY DETECTED",
                instructions="Stop what you are doing. Call national emergency services immediately or request an emergency ambulance.",
                call_number="112",
                dispatch_recommended=True,
            )

    # 2. Chest / Cardiovascular distress
    has_cardiac = any(w in q for w in ["chest", "heart"])
    has_cardiac_symptom = any(w in q for w in ["pain", "pressure", "tightness", "crushing", "attack", "heavy"])
    if has_cardiac and has_cardiac_symptom:
        return EmergencyCard(
            emergency_title="POTENTIAL CARDIAC EMERGENCY DETECTED",
            instructions="Sit upright and rest. Call 112 immediately or request emergency ambulance dispatch.",
            call_number="112",
            dispatch_recommended=True,
        )

    # 3. Severe Respiratory distress
    has_respiratory = any(w in q for w in ["breathe", "breath", "breathing"])
    has_respiratory_issue = any(w in q for w in ["cannot", "can't", "difficulty", "shortness", "hard", "struggling", "choking"])
    if (has_respiratory and has_respiratory_issue) or "lips are turning blue" in q or "blue lips" in q:
        return EmergencyCard(
            emergency_title="ACUTE RESPIRATORY DISTRESS DETECTED",
            instructions="Keep patient in comfortable sitting position. Immediate 112 or ambulance assistance required.",
            call_number="112",
            dispatch_recommended=True,
        )

    # 4. Severe bleeding / Hemorrhage / coughing blood
    has_bleed = any(w in q for w in ["bleed", "bleeding", "hemorrhage", "blood"])
    has_severe = any(w in q for w in ["severe", "uncontrollable", "heavy", "profuse", "coughing", "vomiting"])
    if (has_bleed and has_severe) and not ("gum" in q or "minor" in q or "small" in q):
        return EmergencyCard(
            emergency_title="SEVERE HEMORRHAGE / BLEEDING DETECTED",
            instructions="Apply continuous direct pressure with a clean cloth. Immediate emergency transport required.",
            call_number="112",
            dispatch_recommended=True,
        )

    # 5. Neurological signs (Stroke / FAST)
    has_neuro_body = any(w in q for w in ["arm", "leg", "face", "side of body"])
    has_neuro_symptom = any(w in q for w in ["numb", "numbness", "droop", "drooping", "weakness", "paralysis", "limp"])
    if has_neuro_body and has_neuro_symptom:
        return EmergencyCard(
            emergency_title="ACUTE NEUROLOGICAL / STROKE SYMPTOM DETECTED",
            instructions="Suspected acute stroke event. Call 112 immediately. Note time of symptom onset.",
            call_number="112",
            dispatch_recommended=True,
        )

    # 6. Major burns
    if "burn" in q and any(w in q for w in ["severe", "third-degree", "3rd degree", "major", "explosion", "body"]):
        return EmergencyCard(
            emergency_title="MAJOR BURN EMERGENCY DETECTED",
            instructions="Do not apply ice. Cover with clean dry cloth. Call 112 emergency services immediately.",
            call_number="112",
            dispatch_recommended=True,
        )

    return None



# -------------------------------------------------------------------------
# Corpus Ingestion & RAG In-Memory Index
# -------------------------------------------------------------------------

CORPUS_DIR = os.path.join(os.path.dirname(__file__), "corpus")

class CorpusChunk:
    def __init__(self, source: str, title: str, text: str):
        self.source = source
        self.title = title
        self.text = text
        self.tokens = set(re.findall(r"\w+", text.lower()))

CHUNKS: List[CorpusChunk] = []

def load_corpus():
    global CHUNKS
    CHUNKS = []
    if not os.path.exists(CORPUS_DIR):
        return
    for filepath in glob.glob(os.path.join(CORPUS_DIR, "*.md")):
        basename = os.path.basename(filepath)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        # Split into sections by H2 headers
        sections = content.split("## ")
        main_title = sections[0].split("\n")[0].replace("# ", "").strip()
        for sec in sections[1:]:
            lines = sec.split("\n")
            sec_title = lines[0].strip()
            sec_body = "\n".join(lines[1:]).strip()
            if sec_body:
                CHUNKS.append(
                    CorpusChunk(
                        source=basename,
                        title=f"{main_title} - {sec_title}",
                        text=sec_body,
                    )
                )

load_corpus()

def retrieve_chunks(query: str, top_k: int = 2) -> List[tuple[CorpusChunk, float]]:
    query_tokens = set(re.findall(r"\w+", query.lower()))
    if not query_tokens:
        return []

    scored: List[tuple[CorpusChunk, float]] = []
    for chunk in CHUNKS:
        overlap = query_tokens.intersection(chunk.tokens)
        score = len(overlap) / (len(query_tokens) + 0.1)
        if score > 0.05:
            scored.append((chunk, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


# -------------------------------------------------------------------------
# Specialty Inference
# -------------------------------------------------------------------------

def infer_specialty(text: str) -> Optional[str]:
    t = text.lower()
    if any(k in t for k in ["heart", "chest", "bp", "hypertension", "palpitation"]):
        return "Cardiologist"
    elif any(k in t for k in ["skin", "rash", "itching", "acne", "eczema", "hives"]):
        return "Dermatologist"
    elif any(k in t for k in ["child", "baby", "infant", "pediatric", "vaccine"]):
        return "Pediatrician"
    elif any(k in t for k in ["joint", "bone", "knee", "spine", "ortho", "fracture", "arthritis"]):
        return "Orthopedist"
    elif any(k in t for k in ["ear", "nose", "throat", "sinus", "tonsil", "hearing"]):
        return "ENT Specialist"
    elif any(k in t for k in ["tooth", "teeth", "gum", "dentist", "cavity"]):
        return "Dentist"
    elif any(k in t for k in ["pregnancy", "period", "menstrual", "pcos", "pelvic"]):
        return "Gynecologist"
    elif any(k in t for k in ["fever", "cough", "cold", "flu", "headache", "stomach"]):
        return "General Physician"
    return "General Physician"


# -------------------------------------------------------------------------
# Tool Calling Parser
# -------------------------------------------------------------------------

def detect_tool_intent(message: str) -> Optional[ToolCall]:
    m = message.lower()
    if "book" in m or "schedule" in m or "make an appointment" in m:
        specialty = infer_specialty(m)
        return ToolCall(
            tool="search_doctors",
            arguments={"specialty": specialty},
            requires_confirmation=False,
        )
    elif "hold slot" in m or "reserve slot" in m:
        return ToolCall(
            tool="hold_slot",
            arguments={"slot_time": "nearest"},
            requires_confirmation=False,
        )
    elif "pay" in m or "checkout" in m or "confirm payment" in m:
        return ToolCall(
            tool="create_checkout",
            arguments={"provider": "RAZORPAY"},
            requires_confirmation=True,  # Mandatory human confirmation!
        )
    return None


# -------------------------------------------------------------------------
# Endpoints
# -------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", service="ai-service", version="1.0.0")


@app.post("/triage", response_model=TriageResponse)
def evaluate_triage(req: TriageRequest):
    card = check_emergency(req.query)
    if card:
        return TriageResponse(
            is_emergency=True,
            emergency_card=card,
            urgency_level="CRITICAL",
            recommended_specialty="Emergency Medicine",
            confidence=1.0,
        )

    specialty = infer_specialty(req.query)
    return TriageResponse(
        is_emergency=False,
        emergency_card=None,
        urgency_level="MEDIUM" if specialty != "General Physician" else "LOW",
        recommended_specialty=specialty,
        confidence=0.88,
    )


@app.post("/chat", response_model=ChatResponse)
def clinical_chat(req: ChatRequest):
    # 1. Safety first: check for red-flag emergency
    emergency_card = check_emergency(req.message)
    if emergency_card:
        return ChatResponse(
            is_emergency=True,
            emergency_card=emergency_card,
            reply="EMERGENCY DETECTED: Your symptoms indicate a potentially life-threatening condition. Please call 112 immediately or request an emergency ambulance.",
            citations=[
                Citation(
                    source="emergency_triage.md",
                    title="WHO Emergency Triage & Red-Flag Symptoms",
                    snippet="Critical symptoms require immediate 112 emergency routing.",
                )
            ],
            recommended_specialty="Emergency Medicine",
        )

    # 2. Check for tool execution intent
    tool = detect_tool_intent(req.message)

    # 3. Retrieve relevant clinical / policy context
    matches = retrieve_chunks(req.message, top_k=2)
    citations: List[Citation] = []
    for chunk, _score in matches:
        citations.append(
            Citation(
                source=chunk.source,
                title=chunk.title,
                snippet=chunk.text[:200] + "...",
            )
        )

    specialty = infer_specialty(req.message)

    # 4. Synthesize clinical response with citation references
    if not matches:
        reply = (
            "I could not locate specific verified guidance in our medical knowledge base. "
            f"Based on your symptoms, we recommend booking a consultation with a {specialty} "
            "for an accurate diagnosis and treatment plan."
        )
    else:
        top_chunk = matches[0][0]
        reply = (
            f"Based on verified guidelines from {top_chunk.title} [1], "
            f"patients presenting these symptoms are advised to monitor closely. "
            f"Key clinical note: {top_chunk.text[:180]}... "
            f"We recommend scheduling a consultation with a {specialty}."
        )

    return ChatResponse(
        is_emergency=False,
        emergency_card=None,
        reply=reply,
        citations=citations,
        recommended_specialty=specialty,
        tool_call=tool,
    )


@app.post("/copilot/draft-note", response_model=CopilotResponse)
def generate_copilot_note(req: CopilotRequest):
    transcript_text = "\n".join([f"{m.get('sender', 'User')}: {m.get('content', '')}" for m in req.messages])
    if not transcript_text:
        transcript_text = "No detailed chat messages recorded for this session."

    subjective = f"Patient {req.patient_name} presented for consultation. Summary of reported symptoms from consultation discussion: {transcript_text[:250]}"
    objective = "Virtual telemedicine session conducted. Patient alert and conversant. No obvious acute distress on video."
    assessment = "Clinical impression based on reported symptoms and telemedicine examination. Differential diagnosis recorded for attending doctor review."
    plan = "Attending physician to confirm diagnosis, prescribe approved medication regimen, and schedule follow-up within 7-day chat window."

    return CopilotResponse(
        appointment_id=req.appointment_id,
        soap_note=SoapNote(
            subjective=subjective,
            objective=objective,
            assessment=assessment,
            plan=plan,
        ),
    )
