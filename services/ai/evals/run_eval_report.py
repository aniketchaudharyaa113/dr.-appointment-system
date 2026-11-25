"""
Runs the full quantitative evaluation across:
1. Held-out triage classification split (Keyword baseline vs LogisticRegression vs ML+Safety Hybrid)
2. 105-query Golden Q&A benchmark against a real pgvector/pgvector:pg16 Testcontainer
Writes measured results directly to docs/AI_EVALS.md.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

AI_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_DIR.parents[1]
if str(AI_DIR) not in sys.path:
    sys.path.insert(0, str(AI_DIR))

os.environ.setdefault("LLM_PROVIDER", "mock")

from evals.golden_qa import GOLDEN_QA
import rag as rag_mod
from triage_model import get_triage_model
from main import app


def main():
    model = get_triage_model()
    eval_rep = model.eval_report

    with PostgresContainer("pgvector/pgvector:pg16") as pg:
        os.environ["DATABASE_URL"] = pg.get_connection_url().replace(
            "postgresql+psycopg2://", "postgresql://"
        )
        rag_store = rag_mod.get_rag_store(force_reinit=True)
        client = TestClient(app)

        counts = {}
        passed = {}

        rag_items = [q for q in GOLDEN_QA if q["category"] == "rag_grounded"]
        rag_hits = 0
        for item in rag_items:
            d = client.post("/chat", json={"message": item["query"]}).json()
            if not d["abstained"] and item["expected_source"] in [c["source"] for c in d["citations"]]:
                rag_hits += 1
        counts["rag_grounded"] = len(rag_items)
        passed["rag_grounded"] = rag_hits

        ood_items = [q for q in GOLDEN_QA if q["category"] == "abstain_ood"]
        ood_abstained = 0
        for item in ood_items:
            d = client.post("/chat", json={"message": item["query"]}).json()
            if d.get("abstained") is True and len(d.get("citations", [])) == 0:
                ood_abstained += 1
        counts["abstain_ood"] = len(ood_items)
        passed["abstain_ood"] = ood_abstained

        emerg_items = [q for q in GOLDEN_QA if q["category"] == "emergency"]
        emerg_ok = sum(
            1
            for item in emerg_items
            if client.post("/triage", json={"query": item["query"]}).json()["is_emergency"]
        )
        counts["emergency"] = len(emerg_items)
        passed["emergency"] = emerg_ok

        rout_items = [q for q in GOLDEN_QA if q["category"] == "routine_non_emergency"]
        rout_ok = sum(
            1
            for item in rout_items
            if not client.post("/triage", json={"query": item["query"]}).json()["is_emergency"]
        )
        counts["routine_non_emergency"] = len(rout_items)
        passed["routine_non_emergency"] = rout_ok

        # Unauthenticated booking intent checks (returns require_auth or create_checkout/cancel_appointment safely)
        book_items = [q for q in GOLDEN_QA if q["category"] == "booking_intent"]
        book_ok = 0
        for item in book_items:
            d = client.post("/chat", json={"message": item["query"]}).json()
            if d.get("tool_call") and d["tool_call"].get("requires_confirmation") is True:
                book_ok += 1
        counts["booking_intent"] = len(book_items)
        passed["booking_intent"] = book_ok

        backend = rag_store.backend
        num_chunks = len(rag_store.chunks)

    kw = eval_rep["keyword_baseline"]
    ml = eval_rep["ml_classifier_only"]
    hyb = eval_rep["ml_plus_safety_net"]

    md = f"""# MediBook AI Evaluation Report

Generated from live execution against PostgreSQL `{backend}` (`{num_chunks}` indexed corpus chunks, `all-MiniLM-L6-v2` 384-d embeddings + `tsvector` GIN full-text RRF fusion).

## 1. Emergency Triage Held-Out Evaluation (30% Stratified Split)

- **Dataset size:** {eval_rep['total_dataset']} labeled texts (`emergency`, `urgent`, `routine` across English paraphrases, hard negatives, Hinglish, and Bengali-romanized phrases)
- **Train / Held-out Test Split:** {eval_rep['train_size']} train / {eval_rep['held_out_test_size']} held-out
- **3-Class Classifier Accuracy (LogisticRegression on 384-d embeddings):** {eval_rep['three_class_accuracy']:.4f}

| Detector | Precision | Recall | F1 | Accuracy | False Positives | False Negatives |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Keyword Baseline** | {kw['precision']:.4f} | {kw['recall']:.4f} | {kw['f1']:.4f} | {kw['accuracy']:.4f} | {kw['false_positives']} | {kw['false_negatives']} |
| **Pure ML Classifier (`p >= 0.42`)** | {ml['precision']:.4f} | {ml['recall']:.4f} | {ml['f1']:.4f} | {ml['accuracy']:.4f} | {ml['false_positives']} | {ml['false_negatives']} |
| **ML Classifier + Multi-Lingual Rule Safety Net** | **{hyb['precision']:.4f}** | **{hyb['recall']:.4f}** | **{hyb['f1']:.4f}** | **{hyb['accuracy']:.4f}** | {hyb['false_positives']} | {hyb['false_negatives']} |

## 2. Golden Q&A Benchmark ({len(GOLDEN_QA)} Queries)

| Benchmark Slice | Passed / Total | Rate |
| :--- | :---: | :---: |
| **RAG Grounded Citations (`pgvector` + `tsvector` RRF)** | {passed['rag_grounded']} / {counts['rag_grounded']} | {passed['rag_grounded']/counts['rag_grounded']:.1%} |
| **Out-of-Domain Abstention (< Cosine/RRF Threshold)** | {passed['abstain_ood']} / {counts['abstain_ood']} | {passed['abstain_ood']/counts['abstain_ood']:.1%} |
| **Emergency Golden Recall (EN / Hinglish / Bengali)** | {passed['emergency']} / {counts['emergency']} | {passed['emergency']/counts['emergency']:.1%} |
| **Routine & Hard Negatives (0 False Alarms)** | {passed['routine_non_emergency']} / {counts['routine_non_emergency']} | {passed['routine_non_emergency']/counts['routine_non_emergency']:.1%} |
| **Booking Intent Confirmation Safety (`requires_confirmation`)** | {passed['booking_intent']} / {counts['booking_intent']} | {passed['booking_intent']/counts['booking_intent']:.1%} |
| **Total Golden Q&A** | **{sum(passed.values())} / {sum(counts.values())}** | **{sum(passed.values())/sum(counts.values()):.1%}** |
"""
    (REPO_ROOT / "docs" / "AI_EVALS.md").write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
