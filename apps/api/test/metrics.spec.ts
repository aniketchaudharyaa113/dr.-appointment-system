import { describe, it, expect } from 'vitest';
import { MetricsService } from '../src/modules/platform/metrics/metrics.service';

describe('Prometheus Metrics Service', () => {
  it('should initialize and export Prometheus default and custom metrics format', async () => {
    const service = new MetricsService();

    // Increment custom business metrics
    service.httpRequestsTotal.inc({ method: 'GET', path: '/api/v1/doctors', status_code: '200' }, 5);
    service.bookingConflictsTotal.inc({ doctor_id: 'doc-1', reason: 'slot_held' }, 2);
    service.ledgerZeroSumChecksTotal.inc({ status: 'balanced' }, 10);
    service.ambulanceDispatchDuration.observe(12.5);

    const scraped = await service.getMetrics();
    expect(scraped).toContain('# HELP medibook_http_requests_total');
    expect(scraped).toContain('medibook_http_requests_total{method="GET",path="/api/v1/doctors",status_code="200"} 5');
    expect(scraped).toContain('# HELP medibook_booking_conflicts_total');
    expect(scraped).toContain('medibook_booking_conflicts_total{doctor_id="doc-1",reason="slot_held"} 2');
    expect(scraped).toContain('# HELP medibook_ledger_zero_sum_checks_total');
    expect(scraped).toContain('# HELP medibook_ambulance_dispatch_seconds');
    expect(service.getContentType()).toContain('text/plain');
  });
});
