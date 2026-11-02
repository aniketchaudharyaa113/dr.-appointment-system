import { Injectable, Logger } from '@nestjs/common';

export interface TriageResult {
  isEmergency: boolean;
  emergencyCard?: {
    emergencyTitle: string;
    instructions: string;
    callNumber: string;
    dispatchRecommended: boolean;
  };
  urgencyLevel: string;
  recommendedSpecialty?: string;
  confidence: number;
}

export interface ChatResult {
  isEmergency: boolean;
  emergencyCard?: any;
  reply: string;
  citations: Array<{ source: string; title: string; snippet: string }>;
  recommendedSpecialty?: string;
  toolCall?: {
    tool: string;
    arguments: Record<string, any>;
    requiresConfirmation: boolean;
  };
  disclaimer: string;
}

export interface CopilotNoteResult {
  appointmentId: string;
  soapNote: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    watermark: string;
  };
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly baseUrl: string;
  private isCircuitOpen = false;
  private lastFailureTime = 0;

  constructor() {
    this.baseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
  }

  /**
   * PII Redaction: Scrubs email addresses, phone numbers, and Aadhaar-like IDs.
   */
  redactPii(text: string): string {
    return text
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
      .replace(/(\+?91[\-\s]?)?[6789]\d{9}/g, '[REDACTED_PHONE]')
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_ID]');
  }

  /**
   * Emergency Triage Check
   */
  async triage(query: string, userId?: string): Promise<TriageResult> {
    const redacted = this.redactPii(query);
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: redacted, user_id: userId }),
      });

      if (!res.ok) throw new Error(`AI service returned ${res.status}`);
      const data = await res.json();
      return {
        isEmergency: data.is_emergency,
        emergencyCard: data.emergency_card
          ? {
              emergencyTitle: data.emergency_card.emergency_title,
              instructions: data.emergency_card.instructions,
              callNumber: data.emergency_card.call_number,
              dispatchRecommended: data.emergency_card.dispatch_recommended,
            }
          : undefined,
        urgencyLevel: data.urgency_level,
        recommendedSpecialty: data.recommended_specialty,
        confidence: data.confidence,
      };
    } catch (err) {
      this.logger.warn(`AI service unreachable, using local fallback triage: ${err}`);
      return this.localFallbackTriage(query);
    }
  }

  /**
   * Conversational Assistant & Booking Agent
   */
  async chat(
    message: string,
    userId?: string,
    history: Array<{ sender: string; content: string }> = [],
  ): Promise<ChatResult> {
    const redacted = this.redactPii(message);

    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: redacted,
          user_id: userId,
          conversation_history: history,
        }),
      });

      if (!res.ok) throw new Error(`AI service returned ${res.status}`);
      const data = await res.json();
      return {
        isEmergency: data.is_emergency,
        emergencyCard: data.emergency_card,
        reply: data.reply,
        citations: data.citations || [],
        recommendedSpecialty: data.recommended_specialty,
        toolCall: data.tool_call
          ? {
              tool: data.tool_call.tool,
              arguments: data.tool_call.arguments,
              requiresConfirmation: data.tool_call.requires_confirmation,
            }
          : undefined,
        disclaimer: data.disclaimer,
      };
    } catch (err) {
      this.logger.warn(`AI service down, serving graceful offline response: ${err}`);
      return this.localFallbackChat((q: string) => q)(message);
    }
  }

  /**
   * Doctor Copilot Clinical Note Summarization
   */
  async summarizeNote(
    appointmentId: string,
    doctorId: string,
    patientName: string,
    messages: Array<{ sender: string; content: string }>,
  ): Promise<CopilotNoteResult> {
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/copilot/draft-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: appointmentId,
          doctor_id: doctorId,
          patient_name: patientName,
          messages,
        }),
      });

      if (!res.ok) throw new Error(`AI service returned ${res.status}`);
      const data = await res.json();
      return {
        appointmentId: data.appointment_id,
        soapNote: data.soap_note,
      };
    } catch (err) {
      this.logger.warn(`AI service unreachable for copilot note, using template: ${err}`);
      return {
        appointmentId,
        soapNote: {
          subjective: `Patient ${patientName} consultation discussion recorded.`,
          objective: 'Telemedicine consultation session completed.',
          assessment: 'Clinical evaluation pending attending physician review.',
          plan: 'Follow-up as advised by attending doctor.',
          watermark: 'DRAFT - Requires Attending Doctor Review & Approval',
        },
      };
    }
  }

  private async fetchWithTimeout(url: string, options: any, timeoutMs = 3000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  }

  private localFallbackTriage(query: string): TriageResult {
    const q = String(query).toLowerCase();
    const isEmergency =
      q.includes('chest pain') ||
      q.includes('cannot breathe') ||
      q.includes('heart attack') ||
      q.includes('unconscious') ||
      q.includes('stroke');


    return {
      isEmergency,
      emergencyCard: isEmergency
        ? {
            emergencyTitle: 'POTENTIAL CRITICAL EMERGENCY DETECTED',
            instructions: 'Call 112 immediately or request emergency ambulance dispatch.',
            callNumber: '112',
            dispatchRecommended: true,
          }
        : undefined,
      urgencyLevel: isEmergency ? 'CRITICAL' : 'MEDIUM',
      recommendedSpecialty: isEmergency ? 'Emergency Medicine' : 'General Physician',
      confidence: 0.95,
    };
  }

  private localFallbackChat(_fn: any) {
    return (message: string): ChatResult => {
      const triage = this.localFallbackTriage(message);
      if (triage.isEmergency) {
        return {
          isEmergency: true,
          emergencyCard: triage.emergencyCard,
          reply: 'EMERGENCY DETECTED: Please dial 112 immediately or request emergency ambulance dispatch.',
          citations: [],
          recommendedSpecialty: 'Emergency Medicine',
          disclaimer: 'MediBook Emergency Safety System',
        };
      }

      return {
        isEmergency: false,
        reply:
          'Our AI assistant is temporarily operating in low-connectivity offline mode. You can still search for verified doctors and book available appointments directly.',
        citations: [],
        recommendedSpecialty: 'General Physician',
        disclaimer: 'MediBook AI Safety Disclaimer: Always consult a licensed medical doctor for clinical care.',
      };
    };
  }
}
