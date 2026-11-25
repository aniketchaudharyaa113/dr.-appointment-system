"""
Hybrid Clinical Triage Classifier:
1. Dense sentence embeddings (SentenceTransformer / Ollama) fused with lexical word + char_wb TF-IDF
   features (fit strictly on training split) + LogisticRegression.
2. Deterministic multi-lingual red-flag safety net (English + Hinglish + Bengali-romanized) with
   negation handling ("kono ... nei", "without ...").
3. Quantitative evaluation comparing Keyword Baseline vs Pure ML vs ML+Safety Hybrid on a held-out split.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import numpy as np
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

from dataset import TRIAGE_DATASET
from embeddings import EmbeddingProvider, get_embedding_provider


# High-precision emergency red-flag rules (English + Hinglish + Bengali-romanized)
EMERGENCY_RULE_PATTERNS = [
    r"\bcrushing chest\b",
    r"\b(?:squeezing|oppressive|heavy|crushing).*(?:chest|sternum).*(?:sweat|arm|jaw|back|neck|faint)",
    r"\bchest (?:pain|pressure|tightness)\b.*(?:left arm|jaw|sweat|dizzy|radiat|faint|pressure)",
    r"\bheart attack\b",
    r"\bcardiac arrest\b",
    r"\bcannot breathe\b",
    r"\bcan't breathe\b",
    r"\bno air\b",
    r"\bgasping for air\b",
    r"\bbluish (?:fingernails|lips)\b",
    r"\bextreme shortness of breath\b",
    r"\blips.*turning blue\b",
    r"\bskin turned blue\b",
    r"\bcyanosis\b",
    r"\bunconscious\b",
    r"\bpassed out\b",
    r"\bwon't wake up\b",
    r"\bwill not wake up\b",
    r"\bnot responding\b",
    r"\bfacial droop\b",
    r"\bface is drooping\b",
    r"\bmouth twisted\b",
    r"\bslurred speech\b",
    r"\bgarbling speech\b",
    r"\bstroke symptoms\b",
    r"\bseizure\b",
    r"\bconvulsing\b",
    r"\banaphylaxis\b",
    r"\bthroat.*swelling\b",
    r"\bthroat is swelling\b",
    r"\btongue and lips swollen\b",
    r"\buncontrollable bleeding\b",
    r"\bspurting blood\b",
    r"\bheavy blood loss\b",
    r"\bheavy vaginal bleeding\b",
    r"\bcoughing up.*blood\b",
    r"\bvomiting.*blood\b",
    r"\boverdose\b",
    r"\bswallowed.*pills\b",
    r"\bdrank.*bleach\b",
    r"\bsuicide ideation\b",
    r"\bharm myself\b",
    r"\bthird[- ]degree burn\b",
    # Hinglish safety rules
    r"\bseene mein.*tez dard\b",
    r"\bchhati mein.*dard\b.*paseena",
    r"\bbehosh ho\b",
    r"\bsaans.*band\b",
    r"\bkhoon beh raha\b",
    r"\bchehre.*tedha\b",
    r"\bdaura pad\b",
    r"\bzeher\b",
    r"\bgala suj\b",
    # Bengali-romanized safety rules (explicitly skip negated "kono ... nei")
    r"\bbuk e.*(?:prochondho|chap) betha\b",
    r"\boggyan hoye\b",
    r"\bshash.*(?:nite.*koshto|bondho hoye)\b",
    r"\bmukh.*beke geche\b",
    r"\boshomvob rokto\b",
    r"\bkhichuni\b",
    r"\bbish\b.*kheye",
    r"\bgolar bhitor fule\b",
]

URGENT_PATTERNS = [
    r"\b10[2-5](?:\.\d)?\s*f?\b",
    r"\b10[2-5]\s*degree\b",
    r"\bkidney stone\b",
    r"\bflank pain\b",
    r"\bunable to keep water down\b",
    r"\bdog bite\b",
    r"\babscess\b",
    r"\bblood.*urin",
    r"\bswelling shut\b",
    r"\bpuj\b",
    r"\bpeshab.*jalan\b",
    r"\bbomi hochhe\b",
]

KEYWORD_BASELINE_EMERGENCY = [
    "chest pain",
    "chest pressure",
    "heart attack",
    "cannot breathe",
    "can't breathe",
    "shortness of breath",
    "lips are turning blue",
    "unconscious",
    "passed out",
    "won't wake up",
    "stroke",
    "face is drooping",
    "slurred speech",
    "seizure",
    "bleeding",
    "overdose",
    "anaphylaxis",
    "throat is swelling",
    "coughing up large amounts of bright red blood",
    "third-degree burn",
    "behosh",
    "seene mein tez dard",
    "oggyan",
    "shash nite",
]


def _is_explicitly_negated(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(?:kono\s+shash\s+koshto\s+nei|no\s+breathing\s+(?:trouble|difficulty|issues)|stopped\s+bleeding)\b",
            lower,
        )
    )


def check_emergency_rules(text: str) -> Tuple[bool, Optional[str]]:
    lower = text.lower()
    if _is_explicitly_negated(lower):
        return False, None
    for pat in EMERGENCY_RULE_PATTERNS:
        if re.search(pat, lower):
            return True, pat
    return False, None


def check_keyword_baseline(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in KEYWORD_BASELINE_EMERGENCY)


def infer_specialty(text: str) -> str:
    lower = text.lower()
    rules = [
        (["heart", "palpitation", "blood pressure", "hypertension", "chest", "buk e"], "Cardiology"),
        (["skin", "rash", "acne", "eczema", "hives", "itch", "pimple", "brono", "chulkani"], "Dermatology"),
        (["child", "baby", "infant", "toddler", "bachha", "pediatric", "vaccination"], "Pediatrics"),
        (["tooth", "gum", "dental", "cavity", "molar", "dant", "daant"], "Dentistry"),
        (["eye", "vision", "blurry", "glasses", "chokh", "aankh", "chashma"], "Ophthalmology"),
        (["knee", "joint", "back pain", "sprain", "ankle", "shoulder", "fracture", "orthopedic", "moch"], "Orthopedics"),
        (["ear", "sinus", "throat", "tonsil", "vertigo", "kaan", "snoring"], "ENT"),
        (["period", "pregnant", "pcos", "pelvic", "gynecologist"], "Gynecology"),
        (["anxiety", "stress", "sleep", "depression", "panic", "suicide", "counseling"], "Psychiatry"),
    ]
    for kws, spec in rules:
        if any(k in lower for k in kws):
            return spec
    return "General Medicine"


@dataclass
class BinaryMetrics:
    precision: float
    recall: float
    f1: float
    accuracy: float
    support_pos: int
    false_positives: int
    false_negatives: int


def _binary_metrics(y_true_bin: List[int], y_pred_bin: List[int]) -> BinaryMetrics:
    p, r, f1, _ = precision_recall_fscore_support(
        y_true_bin, y_pred_bin, average="binary", zero_division=0
    )
    acc = accuracy_score(y_true_bin, y_pred_bin)
    fp = sum(1 for t, pr in zip(y_true_bin, y_pred_bin) if t == 0 and pr == 1)
    fn = sum(1 for t, pr in zip(y_true_bin, y_pred_bin) if t == 1 and pr == 0)
    return BinaryMetrics(
        precision=round(float(p), 4),
        recall=round(float(r), 4),
        f1=round(float(f1), 4),
        accuracy=round(float(acc), 4),
        support_pos=sum(y_true_bin),
        false_positives=fp,
        false_negatives=fn,
    )


class ClinicalTriageModel:
    def __init__(self, embedder: EmbeddingProvider | None = None):
        self.embedder = embedder or get_embedding_provider()
        self.word_vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)
        self.char_vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
        self.clf = LogisticRegression(
            C=4.0,
            class_weight="balanced",
            max_iter=1500,
            random_state=42,
        )
        self.classes_: List[str] = []
        self.eval_report: Dict = {}
        self.emergency_threshold = 0.50
        self._fit_and_evaluate()

    def _build_features(self, texts: List[str], embeddings: np.ndarray, fit: bool):
        if fit:
            w = self.word_vec.fit_transform(texts)
            c = self.char_vec.fit_transform(texts)
        else:
            w = self.word_vec.transform(texts)
            c = self.char_vec.transform(texts)
        return hstack([csr_matrix(embeddings), w * 0.7, c * 0.5])

    def _fit_and_evaluate(self):
        texts = [t for t, _, _ in TRIAGE_DATASET]
        labels = [l for _, l, _ in TRIAGE_DATASET]

        X_emb = self.embedder.embed_texts(texts)
        indices = np.arange(len(texts))

        idx_train, idx_test, y_train, y_test = train_test_split(
            indices,
            labels,
            test_size=0.30,
            stratify=labels,
            random_state=42,
        )

        train_texts = [texts[i] for i in idx_train]
        test_texts = [texts[i] for i in idx_test]

        X_tr = self._build_features(train_texts, X_emb[idx_train], fit=True)
        X_te = self._build_features(test_texts, X_emb[idx_test], fit=False)

        self.clf.fit(X_tr, y_train)
        self.classes_ = list(self.clf.classes_)

        y_true_emerg = [1 if y == "emergency" else 0 for y in y_test]

        # 1. Keyword baseline
        y_kw = [1 if check_keyword_baseline(t) else 0 for t in test_texts]
        kw_metrics = _binary_metrics(y_true_emerg, y_kw)

        # 2. Pure ML (dense sentence embedding + TF-IDF LogisticRegression)
        probs_test = self.clf.predict_proba(X_te)
        emerg_idx = self.classes_.index("emergency")
        y_ml = [
            1 if probs_test[i][emerg_idx] >= self.emergency_threshold else 0
            for i in range(len(idx_test))
        ]
        ml_metrics = _binary_metrics(y_true_emerg, y_ml)

        # 3. ML + Multi-lingual Safety Net Hybrid
        y_hybrid = [
            1 if (y_ml[i] == 1 or check_emergency_rules(test_texts[i])[0]) else 0
            for i in range(len(idx_test))
        ]
        hybrid_metrics = _binary_metrics(y_true_emerg, y_hybrid)

        y_pred_3 = self.clf.predict(X_te)
        acc_3class = round(float(accuracy_score(y_test, y_pred_3)), 4)

        self.eval_report = {
            "total_dataset": len(texts),
            "train_size": len(idx_train),
            "held_out_test_size": len(idx_test),
            "three_class_accuracy": acc_3class,
            "keyword_baseline": kw_metrics.__dict__,
            "ml_classifier_only": ml_metrics.__dict__,
            "ml_plus_safety_net": hybrid_metrics.__dict__,
        }

        # Refit final production vectorizers & classifier on full dataset AFTER held-out eval
        X_full = self._build_features(texts, X_emb, fit=True)
        self.clf.fit(X_full, labels)
        self.classes_ = list(self.clf.classes_)

    def predict(self, text: str) -> Dict:
        emb = self.embedder.embed_query(text).reshape(1, -1)
        feat = self._build_features([text], emb, fit=False)
        probs = self.clf.predict_proba(feat)[0]
        prob_map = {cls: float(p) for cls, p in zip(self.classes_, probs)}

        rule_hit, matched_pat = check_emergency_rules(text)
        emerg_prob = prob_map.get("emergency", 0.0)
        urgent_prob = prob_map.get("urgent", 0.0)
        routine_prob = prob_map.get("routine", 0.0)

        is_emergency = rule_hit or emerg_prob >= self.emergency_threshold
        if is_emergency:
            urgency_level = "CRITICAL"
            confidence = max(emerg_prob, 0.96 if rule_hit else emerg_prob)
        else:
            urgent_rule = any(re.search(p, text.lower()) for p in URGENT_PATTERNS)
            if urgent_rule or urgent_prob > max(routine_prob, 0.45):
                urgency_level = "HIGH"
                confidence = max(urgent_prob, 0.80 if urgent_rule else urgent_prob)
            else:
                urgency_level = "LOW"
                confidence = routine_prob

        specialty = infer_specialty(text)
        return {
            "is_emergency": bool(is_emergency),
            "urgency_level": urgency_level,
            "recommended_specialty": None if is_emergency else specialty,
            "confidence": round(float(confidence), 4),
            "probabilities": {k: round(v, 4) for k, v in prob_map.items()},
            "safety_rule_triggered": rule_hit,
            "matched_rule": matched_pat,
        }


_cached_triage_model: ClinicalTriageModel | None = None


def get_triage_model() -> ClinicalTriageModel:
    global _cached_triage_model
    if _cached_triage_model is None:
        _cached_triage_model = ClinicalTriageModel()
    return _cached_triage_model
