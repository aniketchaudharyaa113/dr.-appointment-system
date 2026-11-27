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
  citations: Array<{ source: string; title: string; snippet: string; score?: number }>;
  abstained?: boolean;
  searchBackend?: string;
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
  private defaultTimeoutMs = 3000;
  private circuitOpenMs = 15000;

  constructor() {
    this.baseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
  }

  configure(options: { timeoutMs?: number; circuitOpenMs?: number }) {
    if (options.timeoutMs !== undefined) this.defaultTimeoutMs = options.timeoutMs;
    if (options.circuitOpenMs !== undefined) this.circuitOpenMs = options.circuitOpenMs;
  }

  private buildInternalHeaders(extra?: Record<string, string>): Record<string, string> {
    const token = process.env.AI_INTERNAL_TOKEN;
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'x-internal-token': token } : {}),
      ...(extra ?? {}),
    };
  }

  /**
   * PII Redaction: Scrubs email addresses, standalone 10-digit Indian phone numbers, and 12-digit IDs.
   */
  redactPii(text: string): string {
    return text
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
      .replace(/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '[REDACTED_PHONE]')
      .replace(/(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, '[REDACTED_ID]');
  }

  /**
   * Emergency Triage Check
   */
  async triage(query: string, userId?: string): Promise<TriageResult> {
    const redacted = this.redactPii(query);
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/triage`, {
        method: 'POST',
        headers: this.buildInternalHeaders(),
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
    authHeader?: string,
  ): Promise<ChatResult> {
    const redacted = this.redactPii(message);
    const redactedHistory = history.map((h) => ({
      sender: h.sender,
      content: this.redactPii(h.content),
    }));

    try {
      const res = await this.fetchWithTimeout(
        `${this.baseUrl}/chat`,
        {
          method: 'POST',
          headers: this.buildInternalHeaders(
            authHeader ? { Authorization: authHeader } : undefined,
          ),
          body: JSON.stringify({
            message: redacted,
            user_id: userId,
            conversation_history: redactedHistory,
          }),
        },
        Math.max(this.defaultTimeoutMs, this.defaultTimeoutMs < 3000 ? this.defaultTimeoutMs : 8000),
      );

      if (!res.ok) throw new Error(`AI service returned ${res.status}`);
      const data = await res.json();
      return {
        isEmergency: data.is_emergency,
        emergencyCard: data.emergency_card,
        reply: data.reply,
        citations: data.citations || [],
        abstained: Boolean(data.abstained),
        searchBackend: data.search_backend,
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
    _patientName: string,
    messages: Array<{ sender: string; content: string }>,
  ): Promise<CopilotNoteResult> {
    const redactedMessages = messages.map((m) => ({
      sender: m.sender,
      content: this.redactPii(m.content),
    }));

    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/copilot/draft-note`, {
        method: 'POST',
        headers: this.buildInternalHeaders({ 'x-caller-role': 'DOCTOR' }),
        body: JSON.stringify({
          appointment_id: appointmentId,
          doctor_id: doctorId,
          patient_name: 'Patient',
          messages: redactedMessages,
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
          subjective: 'Patient consultation discussion recorded.',
          objective: 'Telemedicine consultation session completed.',
          assessment: 'Clinical evaluation pending attending physician review.',
          plan: 'Follow-up as advised by attending doctor.',
          watermark: 'DRAFT - Requires Attending Doctor Review & Approval',
        },
      };
    }
  }

  private async fetchWithTimeout(
    url: string,
    options: any,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<Response> {
    if (this.isCircuitOpen) {
      if (Date.now() - this.lastFailureTime < this.circuitOpenMs) {
        throw new Error('AI service circuit breaker is open');
      }
      // Half-open probe allowed after cooldown
      this.isCircuitOpen = false;
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (res.status >= 500) {
        this.isCircuitOpen = true;
        this.lastFailureTime = Date.now();
      } else {
        this.isCircuitOpen = false;
        this.lastFailureTime = 0;
      }
      return res;
    } catch (e) {
      clearTimeout(id);
      this.isCircuitOpen = true;
      this.lastFailureTime = Date.now();
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
      q.includes('stroke') ||
      q.includes('severe bleeding') ||
      q.includes('head injury');

    return {
      isEmergency,
      emergencyCard: isEmergency
        ? {
            emergencyTitle: 'POTENTIAL CRITICAL EMERGENCY DETECTED',
            instructions: 'Call 112 immediately or request emergency ambulance dispatch.',
            callNumber: '112',
            dispatchRecommended: true,
          }
        : {
            emergencyTitle: 'ADVISORY NOTICE',
            instructions: 'Call 112 if severe; book a general physician otherwise.',
            callNumber: '112',
            dispatchRecommended: false,
          },
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
