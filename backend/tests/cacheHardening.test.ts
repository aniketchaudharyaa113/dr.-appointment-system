import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import {
  cacheGet,
  cacheSet,
  getCacheVersion,
  incrCacheVersion,
  normalizeDoctorQueryKey,
  getWithSingleFlight,
  cacheSetWithVersion,
  getCacheMetrics,
  resetCacheMetrics,
} from "../src/cache/redis";

describe("Phase 5: Cache Hardening", () => {
  beforeAll(async () => {
    await startTestEnvironment();
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("normalizes and canonicalizes query keys to prevent unbounded memory", () => {
    // 1. Unordered params with whitespace & casing
    const query1 = {
      specialty: "  Cardiologist  ",
      city: "Kolkata",
      page: "1",
      limit: "10",
      randomSpamParam: "should_be_omitted",
    };

    const query2 = {
      limit: "10",
      anotherAttackPayload: "ignored",
      city: "kolkata",
      specialty: "cardiologist",
      page: "1",
    };

    const key1 = normalizeDoctorQueryKey(query1, 1);
    const key2 = normalizeDoctorQueryKey(query2, 1);

    expect(key1).toBe(key2);
    expect(key1).toContain("v1:city=kolkata&limit=10&page=1&specialty=cardiologist");
    expect(key1).not.toContain("randomSpamParam");
    expect(key1).not.toContain("anotherAttackPayload");

    // 2. Lat/Lng rounding to 2 decimal places
    const geoQuery = {
      lat: "12.345678",
      lng: "77.891234",
      search: "A very long search query that exceeds fifty characters and should be truncated safely by the normalizer",
    };

    const geoKey = normalizeDoctorQueryKey(geoQuery, 1);
    expect(geoKey).toContain("lat=12.35");
    expect(geoKey).toContain("lng=77.89");
    // Ensure search string is capped to 50 chars
    const match = geoKey.match(/search=([^&]+)/);
    expect(match).not.toBeNull();
    expect(decodeURIComponent(match![1]).length).toBeLessThanOrEqual(50);
  });

  it("invalidates cache via version-stamped keys in O(1) without KEYS command", async () => {
    const scope = "doctors:list";
    const v1 = await getCacheVersion(scope);
    const keyV1 = normalizeDoctorQueryKey({ specialty: "neurologist" }, v1);

    await cacheSet(keyV1, { data: "cached_v1" }, 60);
    const readV1 = await cacheGet<any>(keyV1);
    expect(readV1?.data).toBe("cached_v1");

    // Invalidate via version increment
    const v2 = await incrCacheVersion(scope);
    expect(v2).toBe(v1 + 1);

    const keyV2 = normalizeDoctorQueryKey({ specialty: "neurologist" }, v2);
    expect(keyV2).not.toBe(keyV1);

    const readV2 = await cacheGet<any>(keyV2);
    expect(readV2).toBeNull(); // Fresh version produces immediate cache miss without deleting millions of keys
  });

  it("prevents stampedes using single-flight locking for concurrent queries", async () => {
    const testKey = `stampede:test:${Date.now()}`;
    let dbFetchCount = 0;

    const expensiveDbQuery = async () => {
      dbFetchCount++;
      await new Promise((r) => setTimeout(r, 100)); // simulate 100ms slow DB query
      return { payload: "expensive_db_result", timestamp: Date.now() };
    };

    // 10 concurrent requests arrive simultaneously for an un-cached key
    const results = await Promise.all([
      getWithSingleFlight(testKey, expensiveDbQuery, 60),
      getWithSingleFlight(testKey, expensiveDbQuery, 60),
      getWithSingleFlight(testKey, expensiveDbQuery, 60),
      getWithSingleFlight(testKey, expensiveDbQuery, 60),
      getWithSingleFlight(testKey, expensiveDbQuery, 60),
    ]);

    // All callers get the result
    for (const res of results) {
      expect(res.payload).toBe("expensive_db_result");
    }

    // Only one execution hit the database
    expect(dbFetchCount).toBe(1);
  });

  it("prevents slow readers from repopulating cache with stale data after invalidation", async () => {
    const scope = "race_test";
    const vCurrent = await getCacheVersion(scope);
    const staleKey = `medibook:${scope}:test`;

    // Slow reader begins read at version vCurrent
    const slowReaderObservedVersion = vCurrent;

    // Concurrently, an invalidation event occurs
    await incrCacheVersion(scope);

    // Slow reader finishes and tries to populate cache
    const writeAccepted = await cacheSetWithVersion(
      scope,
      slowReaderObservedVersion,
      staleKey,
      { stale: true },
      60
    );

    expect(writeAccepted).toBe(false);

    // Stale data was discarded and never cached
    const cached = await cacheGet<any>(staleKey);
    expect(cached).toBeNull();
  });

  it("accurately tracks cache hit and miss metrics", async () => {
    resetCacheMetrics();

    const metricKey = `metric:test:${Date.now()}`;
    await cacheGet(metricKey); // Miss

    await cacheSet(metricKey, { value: 42 }, 60);
    await cacheGet(metricKey); // Hit
    await cacheGet(metricKey); // Hit

    const metrics = getCacheMetrics();
    expect(metrics.misses).toBeGreaterThanOrEqual(1);
    expect(metrics.hits).toBeGreaterThanOrEqual(2);
    expect(metrics.hitRatio).toBeGreaterThan(0);
    expect(metrics.total).toBe(metrics.hits + metrics.misses);
  });
});
