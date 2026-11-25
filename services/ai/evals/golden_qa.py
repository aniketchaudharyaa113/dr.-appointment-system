"""
Golden Q&A, Triage, Abstention & Booking Benchmark (>= 105 test queries).
Used both by pytest and `run_eval_report.py` to generate docs/AI_EVALS.md.
"""

from __future__ import annotations
from typing import Dict, List

# Categories:
# - rag_grounded: expects abstained=False, expected_source in citation sources
# - abstain_ood: expects abstained=True, len(citations)==0
# - emergency: expects is_emergency=True
# - routine_non_emergency: expects is_emergency=False
# - booking_intent: expects tool_call name matching expected_tool

GOLDEN_QA: List[Dict] = [
    # --- Grounded RAG Policy & Clinical Q&A (32 items) ---
    {"query": "What is the cancellation refund policy more than 24 hours before slot time?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "How much refund do I get if I cancel less than 24 hours early?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "What happens if a doctor cancels my appointment or goes on leave?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "How long does the temporary Redis slot hold last?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "What happens if my payment settles late after the slot hold expired?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "How many minutes early does the video consultation room open?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "For how many days does follow-up chat remain open after appointment?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "How long are slot durations configured by verified doctors?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "Are telemedicine consultations legal in India for registered medical practitioners?", "category": "rag_grounded", "expected_source": "telehealth_guidelines.md"},
    {"query": "Is patient consent mandatory before starting a video consultation?", "category": "rag_grounded", "expected_source": "telehealth_guidelines.md"},
    {"query": "Are Schedule X narcotics allowed to be prescribed over telemedicine?", "category": "rag_grounded", "expected_source": "telehealth_guidelines.md"},
    {"query": "What details must be included on a telemedicine prescription?", "category": "rag_grounded", "expected_source": "telehealth_guidelines.md"},
    {"query": "Should telemedicine handle red-flag emergency symptoms or refer immediately?", "category": "rag_grounded", "expected_source": "telehealth_guidelines.md"},
    {"query": "When should a doctor recommend an in-person exam instead of tele-consult?", "category": "rag_grounded", "expected_source": "telehealth_guidelines.md"},
    {"query": "Which specialist treats chronic hypertension and exertional breathlessness?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "Which doctor should I see for eczema, hives, acne, or fungal skin infections?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "Who treats childhood fever, infant illness, and vaccination schedules?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "Which specialist handles joint arthritis, sprains, and fractures?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "What doctor treats chronic sinusitis, tonsillitis, and vertigo?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "Who should I consult for PCOS and menstrual irregularities?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "Which specialist treats wisdom tooth impaction and gum bleeding?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "Who helps with persistent anxiety, depression, and sleep disturbances?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "What symptoms call for a General Physician evaluation?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "What are the FAST neurological signs of a stroke?", "category": "rag_grounded", "expected_source": "emergency_triage.md"},
    {"query": "Which emergency numbers should be dialed in India for trauma or ambulance?", "category": "rag_grounded", "expected_source": "emergency_triage.md"},
    {"query": "What cardiovascular warning signs require immediate ambulance dispatch?", "category": "rag_grounded", "expected_source": "emergency_triage.md"},
    {"query": "What respiratory distress signs require immediate emergency care?", "category": "rag_grounded", "expected_source": "emergency_triage.md"},
    {"query": "How do you recognize anaphylaxis emergency swelling symptoms?", "category": "rag_grounded", "expected_source": "emergency_triage.md"},
    {"query": "What happens after 30 minutes past slot time in video room access?", "category": "rag_grounded", "expected_source": "platform_policies.md"},
    {"query": "Must telemedicine prescriptions be digitally authenticated and version-controlled?", "category": "rag_grounded", "expected_source": "telehealth_guidelines.md"},
    {"query": "What allergy or skin rash specialist is listed in the guide?", "category": "rag_grounded", "expected_source": "specialty_guide.md"},
    {"query": "What is the ambulance emergency dispatch protocol for red flags?", "category": "rag_grounded", "expected_source": "emergency_triage.md"},

    # --- Out-of-Domain Abstention Queries (20 items) ---
    {"query": "Who won the 2022 FIFA World Cup final in Qatar?", "category": "abstain_ood"},
    {"query": "Write a Python quicksort implementation with type annotations", "category": "abstain_ood"},
    {"query": "What is the orbital period of Jupiter's moon Europa?", "category": "abstain_ood"},
    {"query": "Recommend an exact chemotherapy infusion dosage for lymphoma", "category": "abstain_ood"},
    {"query": "Explain the tax brackets for capital gains in Germany", "category": "abstain_ood"},
    {"query": "Give me a recipe for chocolate soufflé with raspberries", "category": "abstain_ood"},
    {"query": "Which Kubernetes ingress annotation enables canary weights?", "category": "abstain_ood"},
    {"query": "Who composed the Moonlight Sonata on piano?", "category": "abstain_ood"},
    {"query": "How much does a return flight from Tokyo to Sydney cost?", "category": "abstain_ood"},
    {"query": "Explain Gödel's incompleteness theorem mathematically", "category": "abstain_ood"},
    {"query": "What is the current share price of Tesla today?", "category": "abstain_ood"},
    {"query": "How do I tune a carburetor on a vintage motorcycle?", "category": "abstain_ood"},
    {"query": "Summarize the plot of Pride and Prejudice", "category": "abstain_ood"},
    {"query": "Which soil pH grows the sweetest blueberries?", "category": "abstain_ood"},
    {"query": "Translate this Shakespearean sonnet into Latin hexameter", "category": "abstain_ood"},
    {"query": "What graphics card has higher raytracing teraflops in 2026?", "category": "abstain_ood"},
    {"query": "How do you temper dark chocolate at home?", "category": "abstain_ood"},
    {"query": "Who discovered the archaeological ruins of Machu Picchu?", "category": "abstain_ood"},
    {"query": "Compare mortgage interest rates across Australian banks", "category": "abstain_ood"},
    {"query": "Explain how transformer self-attention scales with sequence length", "category": "abstain_ood"},

    # --- Emergency Cases (25 items: English, Paraphrases, Hinglish, Bengali) ---
    {"query": "I have severe crushing chest pain radiating to my left arm", "category": "emergency"},
    {"query": "My father collapsed and is unconscious on the floor", "category": "emergency"},
    {"query": "Suddenly cannot breathe and lips are turning blue", "category": "emergency"},
    {"query": "Severe uncontrollable bleeding from a deep wound", "category": "emergency"},
    {"query": "Half of my face is drooping and my speech is slurred", "category": "emergency"},
    {"query": "My child is having an active seizure for 3 minutes", "category": "emergency"},
    {"query": "Accidentally swallowed an overdose of sleeping pills", "category": "emergency"},
    {"query": "Throat is swelling up after eating peanuts, anaphylaxis", "category": "emergency"},
    {"query": "Sudden extreme shortness of breath and wheezing at rest", "category": "emergency"},
    {"query": "Coughing up large amounts of bright red blood", "category": "emergency"},
    {"query": "Crushing chest pressure with cold sweat", "category": "emergency"},
    {"query": "My husband passed out and won't wake up", "category": "emergency"},
    {"query": "Severe third-degree burn from hot oil explosion", "category": "emergency"},
    {"query": "Stroke symptoms, left side arm numbness", "category": "emergency"},
    {"query": "Sudden difficulty breathing and chest tightness", "category": "emergency"},
    {"query": "Heavy pressure like a weight on my chest spreading into my jaw and clammy", "category": "emergency"},
    {"query": "Mom's mouth twisted to one side and she cannot raise her left arm", "category": "emergency"},
    {"query": "Toddler drank household bleach and is drooling weakly", "category": "emergency"},
    {"query": "Seene mein bahut tez dard ho raha hai aur baayein haath mein ja raha hai", "category": "emergency"},
    {"query": "Papa behosh ho gaye hain aur uth nahi rahe hain", "category": "emergency"},
    {"query": "Achanak saans lena band ho raha hai aur honth neele pad rahe hain", "category": "emergency"},
    {"query": "Buk e prochondho betha hochhe ar ba haath e chhoriye jachhe", "category": "emergency"},
    {"query": "Baba achanak oggyan hoye pore gechen kichutei uthchen na", "category": "emergency"},
    {"query": "Amar shash nite khub koshto hochhe thot nil hoye jachhe", "category": "emergency"},
    {"query": "Kete giye oshomvob rokto porche kichutei thamche na", "category": "emergency"},

    # --- Routine & Hard Negatives (20 items) ---
    {"query": "I have had a mild headache since yesterday morning", "category": "routine_non_emergency"},
    {"query": "Red itchy rash on my forearm for 3 days", "category": "routine_non_emergency"},
    {"query": "Mild heartburn after eating spicy biryani last night", "category": "routine_non_emergency"},
    {"query": "Chest pectoral muscles sore after doing pushups at gym yesterday", "category": "routine_non_emergency"},
    {"query": "Small paper cut on finger while opening mail that stopped bleeding", "category": "routine_non_emergency"},
    {"query": "Acne pimples appearing on my upper chest", "category": "routine_non_emergency"},
    {"query": "Routine annual blood test and thyroid follow-up needed", "category": "routine_non_emergency"},
    {"query": "Halka bukhar aur sardi do din se hai", "category": "routine_non_emergency"},
    {"query": "Gym korar por buk er muscle e halka tana betha lagche", "category": "routine_non_emergency"},
    {"query": "Mild knee stiffness every morning from sitting at desk", "category": "routine_non_emergency"},
    {"query": "Need updated reading glasses checkup with eye specialist", "category": "routine_non_emergency"},
    {"query": "Cold sensitivity when drinking ice water in back tooth", "category": "routine_non_emergency"},
    {"query": "Seasonal morning sneezing and clear runny nose", "category": "routine_non_emergency"},
    {"query": "Mild dandruff on scalp for past month", "category": "routine_non_emergency"},
    {"query": "Heart rate watch shows 66 bpm at rest, asking if healthy", "category": "routine_non_emergency"},
    {"query": "Heartbroken feeling stressed after breakup seeking therapy", "category": "routine_non_emergency"},
    {"query": "Want to schedule routine school vaccination for my child", "category": "routine_non_emergency"},
    {"query": "Du din dhore halka sardi r kashi kono shash koshto nei", "category": "routine_non_emergency"},
    {"query": "Dry cough for two days without breathing trouble", "category": "routine_non_emergency"},
    {"query": "Minor blister on heel from new shoes", "category": "routine_non_emergency"},

    # --- Booking Agent Intents (8 items) ---
    {"query": "Please checkout and pay for my appointment", "category": "booking_intent", "expected_tool": "create_checkout"},
    {"query": "Make payment now for my held consultation slot", "category": "booking_intent", "expected_tool": "create_checkout"},
    {"query": "Cancel my booking and request a refund", "category": "booking_intent", "expected_tool": "cancel_appointment"},
    {"query": "Find available doctors in Cardiology for tomorrow", "category": "booking_intent", "expected_tool": "search_doctors"},
    {"query": "Show doctors specializing in Dermatology today", "category": "booking_intent", "expected_tool": "search_doctors"},
    {"query": "Find a Dentist with available slots", "category": "booking_intent", "expected_tool": "search_doctors"},
    {"query": "Book slot 10:00 with Dr. Subhash Chandra tomorrow", "category": "booking_intent", "expected_tool": "hold_slot"},
    {"query": "Hold slot 11:00 with Dr. Subhash Chandra today", "category": "booking_intent", "expected_tool": "hold_slot"},
]
