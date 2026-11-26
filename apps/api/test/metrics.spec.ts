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

  it('labels unknown / non-existent routes as unmatched_route rather than exploding cardinality with raw path', async () => {
    const randomNotFound = await ctx.app.inject({
      method: 'GET',
      url: `/some/random/unmapped/path/${Date.now()}?token=secret123`,
    });
    expect(randomNotFound.statusCode).toBe(404);

    const metricsRes = await ctx.app.inject({
      method: 'GET',
      url: '/metrics',
    });
    expect(metricsRes.statusCode).toBe(200);
    expect(metricsRes.body).toContain('path="unmatched_route"');
    expect(metricsRes.body).not.toContain('/some/random/unmapped/path');
  });
});
