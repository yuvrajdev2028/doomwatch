import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { startDashboardServer } from './index.js';

describe('Doomwatch Web Dashboard', () => {
  it('should serve HTML dashboard with 200 OK', async () => {
    const server = await startDashboardServer({ port: 0 });
    const port = (server.address() as any).port;

    const res = await new Promise<{ status: number; contentType?: string; body: string }>((resolve, reject) => {
      http.get(`http://localhost:${port}/`, (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            contentType: response.headers['content-type'],
            body: data
          });
        });
      }).on('error', reject);
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.contentType?.includes('text/html'));
    assert.ok(res.body.includes('DOOMWATCH'));
    assert.ok(res.body.includes('waterfall-container'));

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
