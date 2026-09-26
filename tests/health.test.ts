/**
 * PINIT-DNA — Health endpoint contract.
 *
 * GET /health reports the overall state and maps it to an HTTP status that load
 * balancers and uptime monitors act on: healthy -> 200, degraded -> 207,
 * anything else -> 503. The report itself is mocked so this test never touches a
 * real database, Supabase or the filesystem (the previous version imported the
 * whole app against the developer's .env, expected a body the endpoint no longer
 * returns, and needed an undeclared `supertest` package).
 */
import { describe, test, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

type Report = { status: 'healthy' | 'degraded' | 'unhealthy'; components: Record<string, unknown> };
const getHealthReport = jest.fn<() => Promise<Report>>();

jest.mock('../src/lib/health', () => ({ getHealthReport }));
jest.mock('../src/lib/prisma', () => ({ prisma: {} }));
// vectra's nested ESM-only `uuid` cannot be parsed by this Jest setup; the app only
// imports it transitively (semantic search) and this test never uses it.
jest.mock('vectra', () => ({ LocalIndex: class {} }));
jest.mock('../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));

let server: Server;
let base: string;

beforeAll(async () => {
  const { app } = await import('../src/app');
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { getHealthReport.mockReset(); });

describe('GET /health', () => {
  const cases: Array<[Report['status'], number]> = [
    ['healthy', 200],
    ['degraded', 207],
    ['unhealthy', 503],
  ];
  test.each(cases)('a %s report is served as HTTP %i with the report as the body', async (status, http) => {
    getHealthReport.mockResolvedValue({ status, components: { database: { status } } });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(http);
    const body = (await res.json()) as Report;
    expect(body.status).toBe(status);
    expect(body.components).toBeDefined();
  });
});
