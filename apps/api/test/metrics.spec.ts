import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, TestContext } from './helpers/test-app';

describe('Prometheus /metrics Endpoint (Real HTTP)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await bootTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('serves Prometheus text exposition metrics at GET /metrics after real HTTP requests', async () => {
    const healthRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/health/ready',
    });
    expect(healthRes.statusCode).toBe(200);

    const metricsRes = await ctx.app.inject({
      method: 'GET',
      url: '/metrics',
    });
    expect(metricsRes.statusCode).toBe(200);
    expect(metricsRes.headers['content-type']).toContain('text/plain');
    expect(metricsRes.body).toContain('# HELP medibook_http_requests_total');
    expect(metricsRes.body).toContain('medibook_http_requests_total{');
    expect(metricsRes.body).toContain('/api/health/ready');
  });
});
