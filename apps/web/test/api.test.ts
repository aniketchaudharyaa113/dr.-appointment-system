import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fetchApi } from '../src/lib/api.ts';

describe('Web fetchApi & Single-flight token refresh', () => {
  it('should handle 204 No Content without throwing JSON parse error', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = (async () => {
        return new Response(null, { status: 204, statusText: 'No Content' });
      }) as any;

      const result = await fetchApi('/test/no-content');
      assert.strictEqual(result, undefined);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should deduplicate concurrent 401 refresh calls to a single refresh request', async () => {
    const originalFetch = global.fetch;
    let refreshCallCount = 0;
    let apiCallCount = 0;

    try {
      global.fetch = (async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshCallCount++;
          // Simulate network latency
          await new Promise((r) => setTimeout(r, 50));
          return new Response(JSON.stringify({ accessToken: 'new-valid-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        apiCallCount++;
        if (apiCallCount <= 3) {
          // Initial concurrent calls fail with 401
          return new Response(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Retry succeeds
        return new Response(JSON.stringify({ success: true, count: apiCallCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      // Launch 3 concurrent requests that encounter 401
      const [r1, r2, r3] = await Promise.all([
        fetchApi<{ success: boolean }>('/test/resource1'),
        fetchApi<{ success: boolean }>('/test/resource2'),
        fetchApi<{ success: boolean }>('/test/resource3'),
      ]);

      assert.strictEqual(refreshCallCount, 1, 'Only one refresh call should be made');
      assert.strictEqual(r1.success, true);
      assert.strictEqual(r2.success, true);
      assert.strictEqual(r3.success, true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should surface Zod validation field details instead of generic Validation failed', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({
            statusCode: 400,
            message: 'Validation failed',
            error: 'Bad Request',
            details: {
              password: ['Password must contain at least one number'],
            },
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }) as any;

      await assert.rejects(
        () => fetchApi('/auth/register', { method: 'POST', body: '{}' }),
        (err: Error) => {
          assert.strictEqual(err.message, 'Password must contain at least one number');
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
