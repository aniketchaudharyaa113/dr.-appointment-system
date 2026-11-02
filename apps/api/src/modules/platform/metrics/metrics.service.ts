import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: client.Registry;

  public readonly httpRequestsTotal: client.Counter;
  public readonly bookingConflictsTotal: client.Counter;
  public readonly paymentWebhooksTotal: client.Counter;
  public readonly paymentOutcomesTotal: client.Counter;
  public readonly ambulanceDispatchDuration: client.Histogram;
  public readonly ledgerZeroSumChecksTotal: client.Counter;
  public readonly activeSocketsGauge: client.Gauge;

  constructor() {
    this.registry = new client.Registry();
    client.collectDefaultMetrics({ register: this.registry, prefix: 'medibook_' });

    this.httpRequestsTotal = new client.Counter({
      name: 'medibook_http_requests_total',
      help: 'Total number of HTTP requests processed by MediBook API',
      labelNames: ['method', 'path', 'status_code'],
      registers: [this.registry],
    });

    this.bookingConflictsTotal = new client.Counter({
      name: 'medibook_booking_conflicts_total',
      help: 'Total number of slot booking races and concurrent double-booking rejections',
      labelNames: ['doctor_id', 'reason'],
      registers: [this.registry],
    });

    this.paymentWebhooksTotal = new client.Counter({
      name: 'medibook_payment_webhooks_total',
      help: 'Total count of received webhook payloads',
      labelNames: ['provider', 'status'],
      registers: [this.registry],
    });

    this.paymentOutcomesTotal = new client.Counter({
      name: 'medibook_payment_outcomes_total',
      help: 'Total count of final payment captures and automatic refunds',
      labelNames: ['outcome'],
      registers: [this.registry],
    });

    this.ambulanceDispatchDuration = new client.Histogram({
      name: 'medibook_ambulance_dispatch_seconds',
      help: 'Time in seconds from emergency SOS creation to driver acceptance',
      buckets: [5, 10, 15, 20, 30, 45, 60],
      registers: [this.registry],
    });

    this.ledgerZeroSumChecksTotal = new client.Counter({
      name: 'medibook_ledger_zero_sum_checks_total',
      help: 'Total count of double-entry ledger audits where sum(debits) == sum(credits)',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.activeSocketsGauge = new client.Gauge({
      name: 'medibook_active_socket_connections',
      help: 'Currently connected WebSocket clients across consultation and ambulance namespaces',
      labelNames: ['namespace'],
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
