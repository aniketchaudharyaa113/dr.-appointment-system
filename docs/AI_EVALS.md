# MediBook AI Evaluation Report

Generated from live execution against PostgreSQL `pgvector_hybrid` (`12` indexed corpus chunks, `all-MiniLM-L6-v2` 384-d embeddings + `tsvector` GIN full-text RRF fusion).

## 1. Emergency Triage Held-Out Evaluation (30% Stratified Split)

- **Dataset size:** 190 labeled texts (`emergency`, `urgent`, `routine` across English paraphrases, hard negatives, Hinglish, and Bengali-romanized phrases)
- **Train / Held-out Test Split:** 133 train / 57 held-out
- **3-Class Classifier Accuracy (LogisticRegression on 384-d embeddings):** 0.8070

| Detector | Precision | Recall | F1 | Accuracy | False Positives | False Negatives |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Keyword Baseline** | 0.8000 | 0.2000 | 0.3200 | 0.7018 | 1 | 16 |
| **Pure ML Classifier (`p >= 0.42`)** | 0.7895 | 0.7500 | 0.7692 | 0.8421 | 4 | 5 |
| **ML Classifier + Multi-Lingual Rule Safety Net** | **0.8333** | **1.0000** | **0.9091** | **0.9298** | 4 | 0 |

## 2. Golden Q&A Benchmark (105 Queries)

| Benchmark Slice | Passed / Total | Rate |
| :--- | :---: | :---: |
| **RAG Grounded Citations (`pgvector` + `tsvector` RRF)** | 32 / 32 | 100.0% |
| **Out-of-Domain Abstention (< Cosine/RRF Threshold)** | 18 / 20 | 90.0% |
| **Emergency Golden Recall (EN / Hinglish / Bengali)** | 25 / 25 | 100.0% |
| **Routine & Hard Negatives (0 False Alarms)** | 20 / 20 | 100.0% |
| **Booking Intent Confirmation Safety (`requires_confirmation`)** | 8 / 8 | 100.0% |
| **Total Golden Q&A** | **103 / 105** | **98.1%** |
