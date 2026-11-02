import { describe, it, expect, beforeEach } from 'vitest';
import { AiClientService } from '../src/modules/ai-gateway/services/ai-client.service';

describe('Phase 7: AI Gateway Safety, PII Redaction, and Circuit Breaker', () => {
  let aiService: AiClientService;

  beforeEach(() => {
    aiService = new AiClientService();
  });

  it('redacts sensitive PII (emails, phone numbers, identifiers) before upstream requests', () => {
    const raw =
      'Hello, I am John Doe at john.doe@example.com, my phone number is 9876543210 and id is 1234-5678-9012.';
    const redacted = aiService.redactPii(raw);

    expect(redacted).not.toContain('john.doe@example.com');
    expect(redacted).not.toContain('9876543210');
    expect(redacted).not.toContain('1234-5678-9012');

    expect(redacted).toContain('[REDACTED_EMAIL]');
    expect(redacted).toContain('[REDACTED_PHONE]');
    expect(redacted).toContain('[REDACTED_ID]');
  });

  it('immediately triggers emergency triage card for life-threatening conditions in offline fallback', async () => {
    // When python AI service is offline, local fallback triage must still guarantee safety
    const result = await aiService.triage('Severe crushing chest pain and cannot breathe');

    expect(result.isEmergency).toBe(true);
    expect(result.emergencyCard).toBeDefined();
    expect(result.emergencyCard!.callNumber).toBe('112');
    expect(result.emergencyCard!.dispatchRecommended).toBe(true);
    expect(result.urgencyLevel).toBe('CRITICAL');
  });

  it('serves graceful fallback response without crashing when AI service is unreachable', async () => {
    const result = await aiService.chat('What should I do for a mild skin rash?');

    expect(result).toBeDefined();
    expect(result.isEmergency).toBe(false);
    expect(result.reply).toBeDefined();
    expect(result.disclaimer).toContain('MediBook');
  });
});
