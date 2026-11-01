import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";

describe("Phase 7 - Task 7.2: Prometheus Metrics", () => {
  beforeAll(async () => {
    await startTestEnvironment();
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("exposes /metrics in standard Prometheus text exposition format", async () => {
    // Generate some HTTP requests first
    await request(app).get("/");
    await request(app).get("/doctors");

    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");

    const text = res.text;
    expect(text).toContain("http_request_duration_seconds");
    expect(text).toContain("medibook_booking_total");
    expect(text).toContain("medibook_cache_hits_total");
    expect(text).toContain("medibook_cache_misses_total");
    expect(text).toContain("medibook_socket_connections_active");
  });
});
