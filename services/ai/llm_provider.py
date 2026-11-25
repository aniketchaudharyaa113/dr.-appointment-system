"""
LLM Provider abstraction for MediBook AI.
Defaults to Ollama (OLLAMA_URL + OLLAMA_MODEL) in dev/prod when reachable,
and falls back cleanly to DeterministicMockLLMProvider for CI or offline mode.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Dict, List
import httpx


class LLMProvider(ABC):
    provider_name: str

    @abstractmethod
    def generate_rag_answer(
        self,
        query: str,
        chunks: List[Dict],
        recommended_specialty: str | None = None,
    ) -> str:
        """Synthesize a concise clinical/platform answer strictly grounded in chunks."""

    @abstractmethod
    def generate_soap_note(
        self,
        patient_name: str,
        messages: List[Dict[str, str]],
    ) -> Dict[str, str]:
        """Generate a SOAP draft note from consultation messages."""


class DeterministicMockLLMProvider(LLMProvider):
    provider_name = "deterministic_mock"

    def generate_rag_answer(
        self,
        query: str,
        chunks: List[Dict],
        recommended_specialty: str | None = None,
    ) -> str:
        if not chunks:
            return (
                "I do not have verified clinical or platform policy documentation covering that specific question. "
                "Please consult a verified doctor on MediBook or contact support."
            )

        lead = chunks[0]
        bullets = []
        for c in chunks[:2]:
            snippet = " ".join(c["content"].split())
            if len(snippet) > 260:
                snippet = snippet[:257] + "..."
            bullets.append(f"[{c['title']}] {snippet}")

        specialty_hint = (
            f" Based on your query, consulting a verified **{recommended_specialty}** specialist on MediBook is appropriate."
            if recommended_specialty
            else ""
        )
        return (
            f"Based on MediBook verified documentation ({lead['source']}):\n\n"
            + "\n".join(f"- {b}" for b in bullets)
            + specialty_hint
        )

    def generate_soap_note(
        self,
        patient_name: str,
        messages: List[Dict[str, str]],
    ) -> Dict[str, str]:
        patient_msgs = [
            m.get("content", "")
            for m in messages
            if m.get("sender", "").lower() in ("patient", "user")
        ]
        doctor_msgs = [
            m.get("content", "")
            for m in messages
            if m.get("sender", "").lower() == "doctor"
        ]
        subj = "; ".join(patient_msgs) if patient_msgs else f"Patient {patient_name} tele-consultation completed."
        plan = (
            "; ".join(doctor_msgs[-2:])
            if doctor_msgs
            else "Follow clinician medication, hydration, and return-if-worsening guidance."
        )
        return {
            "subjective": f"Patient {patient_name} reports: {subj}",
            "objective": f"Telemedicine encounter reviewed ({len(messages)} transcript turn(s)).",
            "assessment": "Preliminary clinical impression pending attending physician verification.",
            "plan": plan,
            "watermark": "DRAFT - Requires Attending Doctor Review & Approval",
        }


class OllamaLLMProvider(LLMProvider):
    provider_name = "ollama"

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        fallback: LLMProvider | None = None,
    ):
        self.base_url = (base_url or os.getenv("OLLAMA_URL", "http://localhost:11434")).rstrip("/")
        self.model = model or os.getenv("OLLAMA_MODEL", "qwen2.5:latest")
        self.fallback = fallback or DeterministicMockLLMProvider()

    def _chat(self, system: str, user: str) -> str:
        resp = httpx.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "stream": False,
                "options": {"temperature": 0.1},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "").strip()

    def generate_rag_answer(
        self,
        query: str,
        chunks: List[Dict],
        recommended_specialty: str | None = None,
    ) -> str:
        if not chunks:
            return self.fallback.generate_rag_answer(query, chunks, recommended_specialty)
        context = "\n\n".join(
            f"Source: {c['source']} | Section: {c['title']}\n{c['content']}"
            for c in chunks[:3]
        )
        system = (
            "You are MediBook's grounded clinical & platform assistant. Answer strictly using ONLY the "
            "provided context passages. Always cite the source filename (e.g. [platform_policies.md]). "
            "Never diagnose or prescribe. Be concise."
        )
        user = f"Context:\n{context}\n\nQuestion: {query}"
        try:
            text = self._chat(system, user)
            return text or self.fallback.generate_rag_answer(query, chunks, recommended_specialty)
        except Exception:
            return self.fallback.generate_rag_answer(query, chunks, recommended_specialty)

    def generate_soap_note(
        self,
        patient_name: str,
        messages: List[Dict[str, str]],
    ) -> Dict[str, str]:
        transcript = "\n".join(f"{m.get('sender', 'Unknown')}: {m.get('content', '')}" for m in messages)
        system = (
            "Summarize this telemedicine transcript into 4 concise clinical lines prefixed with "
            "S:, O:, A:, P:. Never fabricate vitals."
        )
        try:
            raw = self._chat(system, f"Patient: {patient_name}\n{transcript}")
            lines = {k: "" for k in ("S", "O", "A", "P")}
            for line in raw.splitlines():
                for key in lines:
                    if line.strip().startswith(f"{key}:"):
                        lines[key] = line.split(":", 1)[1].strip()
            if lines["S"] and lines["P"]:
                return {
                    "subjective": lines["S"],
                    "objective": lines["O"] or "Telemedicine encounter conducted.",
                    "assessment": lines["A"] or "Clinical impression pending physician verification.",
                    "plan": lines["P"],
                    "watermark": "DRAFT - Requires Attending Doctor Review & Approval",
                }
        except Exception:
            pass
        return self.fallback.generate_soap_note(patient_name, messages)


def get_llm_provider() -> LLMProvider:
    mode = os.getenv("LLM_PROVIDER", "ollama").lower()
    if mode == "mock":
        return DeterministicMockLLMProvider()
    return OllamaLLMProvider()
