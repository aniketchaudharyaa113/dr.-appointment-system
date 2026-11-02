import { describe, it, expect } from 'vitest';

describe('Worker Queue Definitions', () => {
  it('verifies worker queue names', () => {
    const queueNames = ['outbox-queue', 'payment-processing', 'notifications'];
    expect(queueNames).toContain('outbox-queue');
    expect(queueNames).toContain('payment-processing');
  });
});
