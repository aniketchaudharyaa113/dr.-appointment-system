import { describe, it, expect, beforeEach } from 'vitest';
import * as http from 'node:http';
import { AiClientService } from '../src/modules/ai-gateway/services/ai-client.service';

describe('Slice 5: AI Gateway PII Redaction, JWT Forwarding & Circuit Breaker Fallback', () => {
  let aiService: AiClientService;

  beforeEach(() => {
    aiService = new AiClientService();
  });

  it('redacts sensitive PII (emails, phone numbers, Aadhaar IDs) before upstream requests', () => {
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

  it('forwards authenticated user Authorization Bearer JWT and scrubbed message to upstream AI /chat', async () => {
    let seenAuth: string | undefined;
    let seenBody: any;

    const server = http.createServer((req, res) => {
      seenAuth = req.headers.authorization;
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        seenBody = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            is_emergency: false,
            emergency_card: null,
            reply: 'Grounded reply from pgvector RAG.',
            citations: [{ source: 'platform_policies.md', title: 'Refunds', snippet: '24h rule' }],
            abstained: false,
            search_backend: 'pgvector_hybrid',
            recommended_specialty: 'Cardiology',
            tool_call: {
              tool: 'search_doctors',
              arguments: { doctorId: 'doc-1' },
              requires_confirmation: true,
            },
            disclaimer: 'MediBook AI disclaimer',
          }),
        );
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const oldUrl = process.env.AI_SERVICE_URL;
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${addr.port}`;

    try {
      const client = new AiClientService();
      const result = await client.chat(
        'Book cardiologist email me at a@b.com',
        'user-123',
        [],
        'Bearer user.jwt.real',
      );

      expect(seenAuth).toBe('Bearer user.jwt.real');
      expect(seenBody.message).toContain('[REDACTED_EMAIL]');
      expect(seenBody.message).not.toContain('a@b.com');
      expect(result.searchBackend).toBe('pgvector_hybrid');
      expect(result.abstained).toBe(false);
      expect(result.toolCall?.requiresConfirmation).toBe(true);
    } finally {
      server.close();
      if (oldUrl !== undefined) process.env.AI_SERVICE_URL = oldUrl;
      else delete process.env.AI_SERVICE_URL;
    }
  });

  it('immediately triggers emergency triage card for life-threatening conditions in offline fallback', async () => {
    const result = await aiService.triage('Severe crushing chest pain and cannot breathe');

    expect(result.isEmergency).toBe(true);
    expect(result.emergencyCard).toBeDefined();
    expect(result.emergencyCard!.callNumber).toBe('112');
    expect(result.emergencyCard!.dispatchRecommended).toBe(true);
    expect(result.urgencyLevel).toBe('CRITICAL');
  });

  it('serves graceful fallback response without crashing when AI service is unreachable', async () => {
    const oldUrl = process.env.AI_SERVICE_URL;
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:59999';
    const client = new AiClientService();
    try {
      const result = await client.chat('What should I do for a mild skin rash?');
      expect(result).toBeDefined();
      expect(result.isEmergency).toBe(false);
      expect(result.reply).toBeDefined();
      expect(result.disclaimer).toContain('MediBook');

      const triageResult = await client.triage('Mild headache and slight fever');
      expect(triageResult.isEmergency).toBe(false);
      expect(triageResult.emergencyCard?.instructions).toBe(
        'Call 112 if severe; book a general physician otherwise.',
      );
      expect(triageResult.recommendedSpecialty).toBe('General Physician');
    } finally {
      if (oldUrl !== undefined) process.env.AI_SERVICE_URL = oldUrl;
      else delete process.env.AI_SERVICE_URL;
    }
  });
});
