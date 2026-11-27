"""
MediBook AI Evaluations Suite
Verifies:
1. Real Postgres pgvector + GIN tsvector hybrid RAG search via Testcontainers (`pgvector/pgvector:pg16`)
2. Score-threshold abstention on out-of-domain queries
3. Stratified held-out emergency classifier metrics vs keyword baseline (target recall >= 0.97)
4. Golden Q&A suite (>= 100 items) across RAG citations, emergency safety, hard negatives, abstention, and booking intents
5. Booking agent executing real API requests with the authenticated user's own JWT token
"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

AI_DIR = Path(__file__).resolve().parents[1]
if str(AI_DIR) not in sys.path:
    sys.path.insert(0, str(AI_DIR))

os.environ.setdefault("LLM_PROVIDER", "mock")

from evals.golden_qa import GOLDEN_QA
import rag as rag_mod
from triage_model import get_triage_model
from main import app


@pytest.fixture(scope="module")
def pgvector_rag():
    """Spin up a real pgvector/pgvector:pg16 Testcontainer for hybrid RAG verification."""
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("pgvector/pgvector:pg16") as pg:
        db_url = pg.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
        os.environ["DATABASE_URL"] = db_url
        rag_mod._cached_rag = None
        store = rag_mod.get_rag_store(force_reinit=True)
        yield store


def test_golden_qa_dataset_size():
    assert len(GOLDEN_QA) >= 100, f"Expected >= 100 golden QA queries, found {len(GOLDEN_QA)}"


def test_held_out_classifier_metrics_and_baseline_comparison():
    model = get_triage_model()
    report = model.eval_report
    assert report["total_dataset"] >= 150
    hybrid = report["ml_plus_safety_net"]
    kw = report["keyword_baseline"]

    # Target: emergency recall >= 0.97 on held-out split with high F1 & strong precision vs baseline
    assert hybrid["recall"] >= 0.97, (
        f"Held-out ML+Safety emergency recall {hybrid['recall']} < 0.97; full report={report}"
    )
    assert hybrid["precision"] >= 0.80
    assert hybrid["f1"] >= kw["f1"]


def test_real_pgvector_hybrid_rag_citations_and_abstention(pgvector_rag):
    assert pgvector_rag.backend == "pgvector_hybrid"
    assert len(pgvector_rag.chunks) >= 8

    client = TestClient(app)

    # Verify /health reflects live pgvector backend
    health = client.get("/health").json()
    assert health["rag_backend"] == "pgvector_hybrid"
    assert health["embedding_dim"] == 384

    rag_items = [q for q in GOLDEN_QA if q["category"] == "rag_grounded"]
    hits = 0
    for item in rag_items:
        res = client.post("/chat", json={"message": item["query"]})
        assert res.status_code == 200
        data = res.json()
        assert data["abstained"] is False, f"Unexpected abstention on: {item['query']}"
        sources = [c["source"] for c in data["citations"]]
        if item["expected_source"] in sources:
            hits += 1

    citation_hit_rate = hits / len(rag_items)
    assert citation_hit_rate >= 0.90, f"RAG citation hit rate too low: {citation_hit_rate:.3f}"

    # Verify out-of-domain queries abstain cleanly with zero fabricated citations
    ood_items = [q for q in GOLDEN_QA if q["category"] == "abstain_ood"]
    abstained_count = 0
    for item in ood_items:
        res = client.post("/chat", json={"message": item["query"]})
        assert res.status_code == 200
        data = res.json()
        if data.get("abstained") is True and len(data.get("citations", [])) == 0:
            abstained_count += 1

    abstention_rate = abstained_count / len(ood_items)
    assert abstention_rate >= 0.90, f"OOD abstention rate too low: {abstention_rate:.3f}"


def test_golden_emergency_and_routine_triage_safety():
    client = TestClient(app)

    emerg_items = [q for q in GOLDEN_QA if q["category"] == "emergency"]
    emerg_detected = 0
    for item in emerg_items:
        res = client.post("/triage", json={"query": item["query"]})
        assert res.status_code == 200
        if res.json()["is_emergency"]:
            emerg_detected += 1
    assert emerg_detected / len(emerg_items) >= 0.97

    routine_items = [q for q in GOLDEN_QA if q["category"] == "routine_non_emergency"]
    false_alarms = 0
    for item in routine_items:
        res = client.post("/triage", json={"query": item["query"]})
        assert res.status_code == 200
        if res.json()["is_emergency"]:
            false_alarms += 1
    assert false_alarms == 0, f"Hard-negative false positives detected: {false_alarms}"


def test_booking_agent_calls_real_api_with_user_jwt():
    captured_auth_headers = []
    captured_paths = []

    class FakeNestApiHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def do_GET(self):
            captured_auth_headers.append(self.headers.get("Authorization"))
            captured_paths.append(self.path)
            if self.path.startswith("/api/doctors/doc-1/slots"):
                body = {"slots": [{"slotTime": "10:00:00", "slotIso": "2026-11-26T10:00:00+05:30", "status": "AVAILABLE"}]}
            elif self.path.startswith("/api/doctors"):
                body = {"items": [{"id": "doc-1", "specialty": "Cardiology", "consultationFeePaise": 80000, "user": {"name": "Dr. Subhash Chandra"}}]}
            else:
                body = {}
            raw = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            captured_auth_headers.append(self.headers.get("Authorization"))
            captured_paths.append(self.path)
            body = {"holdToken": "tok-real-123", "expiresInSeconds": 600}
            raw = json.dumps(body).encode()
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = HTTPServer(("127.0.0.1", 0), FakeNestApiHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    old_api_url = os.environ.get("API_INTERNAL_URL")
    os.environ["API_INTERNAL_URL"] = f"http://127.0.0.1:{port}/api"
    client = TestClient(app)

    try:
        user_jwt = "Bearer user.jwt.token.abc"
        res = client.post(
            "/chat",
            headers={"Authorization": user_jwt},
            json={"message": "Hold slot 10:00 with Dr. Subhash Chandra tomorrow"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["tool_call"]["tool"] == "hold_slot"
        assert data["tool_call"]["requires_confirmation"] is True
        assert data["tool_call"]["arguments"]["holdToken"] == "tok-real-123"
        assert any(p.startswith("/api/doctors") for p in captured_paths)
        assert "/api/appointments/hold" in captured_paths
        assert all(h == user_jwt for h in captured_auth_headers)
    finally:
        server.shutdown()
        if old_api_url is not None:
            os.environ["API_INTERNAL_URL"] = old_api_url
        else:
            os.environ.pop("API_INTERNAL_URL", None)


def test_copilot_soap_note_generation():
    client = TestClient(app)
    payload = {
        "appointment_id": "appt-test-123",
        "doctor_id": "doc-test-456",
        "patient_name": "Patient",
        "messages": [
            {"sender": "Patient", "content": "Doctor, I have had a dry cough for 3 days"},
            {"sender": "Doctor", "content": "Any fever or breathlessness?"},
            {"sender": "Patient", "content": "No fever, just throat irritation"},
        ],
    }

    # Unauthenticated / non-DOCTOR role rejected even without AI_INTERNAL_TOKEN
    unauth_role = client.post("/copilot/draft-note", json=payload)
    assert unauth_role.status_code == 403

    res = client.post(
        "/copilot/draft-note",
        headers={"X-Caller-Role": "DOCTOR"},
        json=payload,
    )
    assert res.status_code == 200
    soap = res.json()["soap_note"]
    assert len(soap["subjective"]) > 10
    assert "Requires Attending Doctor Review" in soap["watermark"]


def test_ai_service_internal_token_enforcement():
    client = TestClient(app)
    prev_token = os.environ.get("AI_INTERNAL_TOKEN")
    os.environ["AI_INTERNAL_TOKEN"] = "eval-internal-secret"
    try:
        # Missing token rejected across /triage, /chat, /copilot/draft-note
        assert client.post("/triage", json={"query": "mild fever"}).status_code == 401
        assert client.post("/chat", json={"message": "hello"}).status_code == 401
        assert (
            client.post(
                "/copilot/draft-note",
                headers={"X-Caller-Role": "DOCTOR"},
                json={"appointment_id": "a", "doctor_id": "d", "patient_name": "Patient", "messages": []},
            ).status_code
            == 401
        )

        # Wrong token rejected
        assert (
            client.post(
                "/triage",
                headers={"X-Internal-Token": "wrong"},
                json={"query": "mild fever"},
            ).status_code
            == 401
        )

        # Valid token succeeds
        ok = client.post(
            "/triage",
            headers={"X-Internal-Token": "eval-internal-secret"},
            json={"query": "mild fever"},
        )
        assert ok.status_code == 200
    finally:
        if prev_token is not None:
            os.environ["AI_INTERNAL_TOKEN"] = prev_token
        else:
            os.environ.pop("AI_INTERNAL_TOKEN", None)
