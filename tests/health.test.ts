/**
 * PINIT-DNA — Health Check Test
 * Verifies the Express app starts and responds correctly.
 */

import request from 'supertest';
import { app } from '../src/app';

describe('GET /health', () => {
  it('returns 200 with service info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('pinit-dna');
  });
});
