# Phase 7 Plan: AI Intelligence Service & NestJS AI Gateway

## Objectives
1. Safety-First Emergency Triage Detector:
   - Hardcoded rule-based + lexical emergency trigger filter running BEFORE any generative LLM inference.
   - If emergency detected -> immediately returns emergency response card (Click to call 112, dispatch ambulance CTA) and completely bypasses LLM generation.
   - 100% recall benchmark target on life-threatening symptoms (chest pain, stroke signs, anaphylaxis, severe respiratory distress).
2. Curated Clinical Corpus & RAG Architecture:
   - `services/ai/corpus/`: curated public health knowledge, WHO/MoHFW preventive care guidelines, MediBook booking & refund policies, specialty index.
   - Hybrid retrieval: BM25/keyword matching + cosine vector similarity.
   - Strict citation requirement: Every answer provides citation chips (`[1]`, `[2]`) pointing to source files.
   - Weak retrieval threshold: If confidence is low, outputs standardized safe fallback: "I cannot find verified medical information on this topic. Please consult a qualified doctor."
   - Guardrails: Strictly prohibits diagnostic assertions ("You have condition X"). Employs non-diagnostic, informational phrasing ("These symptoms are commonly associated with... Consult a physician for accurate diagnosis").
3. Conversational Booking Agent (Tool Calling):
   - End-user context propagation: tool execution executes strictly under the caller's JWT scope.
   - Tools:
     - `search_doctors(specialty, fee_max)`
     - `get_available_slots(doctor_id, date)`
     - `hold_slot(doctor_id, slot_time)`
     - `request_checkout(appointment_id)`
   - Mandatory human-in-the-loop confirmation before any action requiring payment.
4. Doctor Clinical Copilot (SOAP Note Summarizer):
   - Ingests consultation chat history.
   - Formats clinical draft note adhering to SOAP standard:
     - **S**ubjective: chief complaint, history of present illness.
     - **O**bjective: vitals, observations.
     - **A**ssessment: clinical observations for doctor review.
     - **P**lan: suggested prescription draft and follow-up guidance.
   - Watermarked as `DRAFT - Requires Attending Doctor Review & Approval`. Never auto-commits to medical record.
5. Evaluations & Truthful Documentation:
   - `services/ai/evals/test_evals.py`: 100+ labeled test cases testing emergency detection, retrieval faithfulness, and tool intent.
   - `docs/AI_EVALS.md`: Detailed comparison table of classifier vs keyword baseline (Precision, Recall, F1-Score).
   - ADR explanation: Why MediBook uses RAG rather than generative model fine-tuning (traceability, zero knowledge hallucination drift, real-time doctor availability updates).
6. NestJS AI Gateway (`apps/api/src/modules/ai-gateway`):
   - HTTP client with circuit breaker, 5-second timeout, 2x retry, and graceful offline fallback.
   - PII redaction layer scrubbing patient phone numbers, emails, and identifiers before sending prompts.
