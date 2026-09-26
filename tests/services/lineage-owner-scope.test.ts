/**
 * getLineage used to return both ends of every edge with no owner check, so a
 * duplicate recorded from another account exposed that account's filename and
 * record ID to whoever owned the other end. With an ownerUserId, edges that
 * touch a record owned by someone else are dropped.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const findMany = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: { documentLineage: { findMany } },
}));
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { DocumentLineageService } from '../../src/services/lineage/document-lineage.service';

const rec = (id: string, owner: string, name: string) => ({
  id, imageFilename: name, fileType: 'PDF', createdAt: new Date('2026-01-01T00:00:00Z'), ownerUserId: owner,
});
const edge = (from: ReturnType<typeof rec>, to: ReturnType<typeof rec>) => ({
  fromDnaRecordId: from.id, toDnaRecordId: to.id, relation: 'DUPLICATE', confidence: 0.99,
  createdAt: new Date('2026-01-02T00:00:00Z'), fromDnaRecord: from, toDnaRecord: to,
});

const mine = rec('mine-1', 'user-a', 'mine.pdf');
const mine2 = rec('mine-2', 'user-a', 'mine-copy.pdf');
const theirs = rec('theirs-1', 'user-b', 'SECRET-other-user.pdf');

beforeEach(() => {
  findMany.mockReset();
});

// The service issues two findMany calls (outgoing, incoming).
function seed(outgoing: unknown[], incoming: unknown[]) {
  findMany.mockResolvedValueOnce(outgoing).mockResolvedValueOnce(incoming);
}

describe('DocumentLineageService.getLineage owner scoping', () => {
  test('with an owner: an edge to another user\'s record is dropped, own edges are kept', async () => {
    seed([edge(mine, mine2), edge(mine, theirs)], []);
    const g = await new DocumentLineageService().getLineage('mine-1', 'user-a');
    expect(g.nodes.map((n) => n.dnaRecordId).sort()).toEqual(['mine-1', 'mine-2']);
    expect(g.edges).toHaveLength(1);
    expect(JSON.stringify(g)).not.toContain('SECRET-other-user.pdf');
    expect(JSON.stringify(g)).not.toContain('theirs-1');
  });

  test('with an owner: incoming edges from another user are dropped too', async () => {
    seed([], [edge(theirs, mine)]);
    const g = await new DocumentLineageService().getLineage('mine-1', 'user-a');
    expect(g).toEqual({ nodes: [], edges: [] });
  });

  test('without an owner the behaviour is unchanged (internal callers such as investigations)', async () => {
    seed([edge(mine, theirs)], []);
    const g = await new DocumentLineageService().getLineage('mine-1');
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
  });
});
